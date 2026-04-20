import { inspect } from "util";
import { getStats } from "../copy-trade/core";

const MAX_EVENTS_STORED = 40;
const MAX_CONSOLE_BUFFER = 400;

interface EquityPoint {
    timestamp: number;
    value: number;
}

type ConsoleMethod = (...args: unknown[]) => void;

class TerminalDashboard {
    private running = false;
    private renderTimer: NodeJS.Timeout | null = null;
    private events: string[] = [];
    private equity: EquityPoint[] = [];
    private modeLabel = "LIVE";
    private consoleBuffer: string[] = [];
    private origConsole: { log: ConsoleMethod; error: ConsoleMethod; warn: ConsoleMethod } | null = null;

    start(modeLabel: string): void {
        if (!process.stdout.isTTY || this.running) return;
        this.running = true;
        this.modeLabel = modeLabel;
        process.stdout.write("\x1B[?25l");
        this.patchConsole();
        this.addEvent(`Dashboard started (${modeLabel})`);
        this.render();
        this.renderTimer = setInterval(() => this.render(), 1000);
    }

    stop(): void {
        if (this.renderTimer) clearInterval(this.renderTimer);
        this.renderTimer = null;
        this.running = false;
        this.unpatchConsole();
        if (process.stdout.isTTY) {
            process.stdout.write("\x1B[?25h");
        }
    }

    addEvent(message: string): void {
        const line = `${new Date().toLocaleTimeString()} | ${message}`;
        this.events.push(line);
        if (this.events.length > MAX_EVENTS_STORED) this.events = this.events.slice(-MAX_EVENTS_STORED);
    }

    pushEquity(value: number): void {
        if (!Number.isFinite(value) || value < 0) return;
        this.equity.push({ timestamp: Date.now(), value });
        if (this.equity.length > 80) this.equity = this.equity.slice(-80);
    }

    private stripAnsi(s: string): string {
        return s.replace(/\u001b\[[\d;?]*[ -/]*[@-~]/g, "");
    }

    private formatConsoleArgs(args: unknown[]): string {
        return args
            .map((a) => (typeof a === "string" ? a : inspect(a, { breakLength: 100, colors: false, depth: 3 })))
            .join(" ");
    }

    private pushConsoleLine(raw: string): void {
        const oneLine = this.stripAnsi(raw).replace(/\r?\n/g, " ").trim();
        if (!oneLine) return;
        const ts = new Date().toLocaleTimeString();
        this.consoleBuffer.push(`${ts} | ${oneLine}`);
        if (this.consoleBuffer.length > MAX_CONSOLE_BUFFER) {
            this.consoleBuffer = this.consoleBuffer.slice(-MAX_CONSOLE_BUFFER);
        }
    }

    private patchConsole(): void {
        if (this.origConsole) return;
        this.origConsole = {
            log: console.log.bind(console) as ConsoleMethod,
            error: console.error.bind(console) as ConsoleMethod,
            warn: console.warn.bind(console) as ConsoleMethod,
        };
        const o = this.origConsole;
        console.log = (...args: unknown[]) => {
            this.pushConsoleLine(this.formatConsoleArgs(args));
        };
        console.warn = (...args: unknown[]) => {
            this.pushConsoleLine(`WARN ${this.formatConsoleArgs(args)}`);
        };
        console.error = (...args: unknown[]) => {
            this.pushConsoleLine(`ERR ${this.formatConsoleArgs(args)}`);
            o.error(...args);
        };
    }

    private unpatchConsole(): void {
        if (!this.origConsole) return;
        console.log = this.origConsole.log;
        console.error = this.origConsole.error;
        console.warn = this.origConsole.warn;
        this.origConsole = null;
    }

    private truncate(s: string, maxLen: number): string {
        if (maxLen <= 0) return "";
        if (s.length <= maxLen) return s;
        return s.slice(0, Math.max(0, maxLen - 1)) + "…";
    }

    private padCell(s: string, width: number): string {
        const t = this.truncate(s, width);
        return t.length >= width ? t : t + " ".repeat(width - t.length);
    }

    /** Zip two columns with a visible gutter so left/right never overlap. */
    private zipColumns(left: string[], right: string[], leftW: number, rightW: number, gutter: string): string[] {
        const n = Math.max(left.length, right.length);
        const out: string[] = [];
        for (let i = 0; i < n; i++) {
            const L = this.padCell(left[i] ?? "", leftW);
            const R = this.padCell(right[i] ?? "", rightW);
            out.push(`${L}${gutter}${R}`);
        }
        return out;
    }

    private renderConsoleFooter(cols: number, maxLines: number): string[] {
        const sep = "-".repeat(cols);
        const head = this.truncate("* CONSOLE (stdout / stderr — newest at bottom)", cols);
        const slot = Math.max(1, maxLines - 2);
        const tail = this.consoleBuffer.slice(-slot);
        const lines = tail.map((e) => this.truncate(e, cols));
        while (lines.length < slot) lines.unshift("");
        if (tail.length === 0 && this.consoleBuffer.length === 0 && slot > 0) {
            lines[lines.length - 1] = this.truncate("(no console output yet)", cols);
        }
        return [sep, head, ...lines];
    }

    private render(): void {
        if (!this.running) return;

        const rows = Math.max(18, process.stdout.rows || 24);
        const cols = Math.max(40, process.stdout.columns || 80);
        const consoleRows = Math.min(22, Math.max(6, Math.floor(rows * 0.28)));
        const headerLines = 3;
        const sepBeforeConsole = 1;
        const bodyRows = Math.max(6, rows - headerLines - sepBeforeConsole - consoleRows);

        const stats = getStats();
        const now = new Date();
        const title = this.truncate(`POLYMARKET BOT DASHBOARD | ${this.modeLabel} | ${now.toLocaleTimeString()}`, cols);
        const topRule = "=".repeat(cols);
        const midRule = "-".repeat(cols);

        const pnl = this.getPnlSummary();
        const tradesLine = `Trades  d:${stats.tradesDetected} c:${stats.tradesCopied} s:${stats.tradesSkipped} f:${stats.tradesFailed}`;
        const equityLine = `Equity  $${pnl.latest.toFixed(2)} (start $${pnl.start.toFixed(2)})  pnl ${pnl.delta >= 0 ? "+" : ""}$${pnl.delta.toFixed(2)} (${pnl.pct >= 0 ? "+" : ""}${pnl.pct.toFixed(2)}%)`;

        const gutter = " | ";
        const gutterLen = gutter.length;
        const minColsTwoPane = 56;

        let lines: string[];
        if (cols < minColsTwoPane) {
            const w = cols - 2;
            const chartLines = this.renderEquityChartCompact(w, bodyRows);
            const ev = this.events.slice(-Math.max(4, bodyRows - 8));
            const evBlock =
                ev.length === 0
                    ? ["* EVENTS", "(no events yet)"]
                    : ["* EVENTS", ...ev.map((e) => this.truncate(e, w))];
            const statBlock = [
                "* STATS & USDC",
                this.truncate(tradesLine, w),
                this.truncate(equityLine, w),
                "-",
                "ASSET",
                ...chartLines.map((l) => this.truncate(l, w)),
            ];
            lines = [topRule, this.truncate(title, cols), midRule, ...evBlock, midRule, ...statBlock, midRule];
        } else {
            const leftW = Math.max(22, Math.floor((cols - gutterLen) * 0.46));
            const rightW = cols - leftW - gutterLen;

            const chartLines = this.renderEquityChartCompact(rightW, bodyRows);
            const eventSlots = Math.max(4, bodyRows - 2);
            const ev = this.events.slice(-eventSlots);

            const leftCol: string[] = ["* EVENTS (left)"];
            if (ev.length === 0) leftCol.push("(no events yet)");
            else leftCol.push(...ev.map((e) => this.truncate(e, leftW)));

            const rightCol: string[] = [
                "* STATS / USDC (right)",
                this.truncate(tradesLine, rightW),
                this.truncate(equityLine, rightW),
                "-",
                "ASSET",
                ...chartLines.map((l) => this.truncate(l, rightW)),
            ];

            while (leftCol.length < rightCol.length) leftCol.push("");
            while (rightCol.length < leftCol.length) rightCol.push("");

            const body = this.zipColumns(leftCol, rightCol, leftW, rightW, gutter);
            lines = [topRule, this.truncate(title, cols), midRule, ...body, midRule];
        }

        lines.push(...this.renderConsoleFooter(cols, consoleRows));

        process.stdout.write("\x1B[2J\x1B[H");
        process.stdout.write(lines.join("\n") + "\n");
    }

    private getPnlSummary(): { start: number; latest: number; delta: number; pct: number } {
        if (this.equity.length === 0) return { start: 0, latest: 0, delta: 0, pct: 0 };
        const start = this.equity[0].value;
        const latest = this.equity[this.equity.length - 1].value;
        const delta = latest - start;
        const pct = start > 0 ? (delta / start) * 100 : 0;
        return { start, latest, delta, pct };
    }

    private renderEquityChartCompact(rightColWidth: number, termRows: number): string[] {
        if (this.equity.length === 0) return ["(no samples)"];
        if (this.equity.length === 1) {
            const v = this.equity[0].value;
            return [`$${v.toFixed(2)} (need 2+ pts)`];
        }

        const maxChars = Math.max(16, Math.min(rightColWidth, 48, termRows > 22 ? 48 : 36));
        const points = this.equity.slice(-maxChars).map((p) => p.value);
        const min = Math.min(...points);
        const max = Math.max(...points);
        const blocks = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

        if (max === min) {
            return [`${"▅".repeat(Math.min(points.length, maxChars))}`, `flat $${min.toFixed(2)}`];
        }

        const sparkline = points
            .map((v) => {
                const idx = Math.min(
                    blocks.length - 1,
                    Math.max(0, Math.floor(((v - min) / (max - min)) * (blocks.length - 1)))
                );
                return blocks[idx];
            })
            .join("");

        return [this.truncate(sparkline, rightColWidth), `min ${min.toFixed(2)} max ${max.toFixed(2)}`];
    }
}

export const dashboard = new TerminalDashboard();
