import { getStats } from "../copy-trade/core";

const MAX_EVENTS_STORED = 30;

interface EquityPoint {
    timestamp: number;
    value: number;
}

class TerminalDashboard {
    private running = false;
    private renderTimer: NodeJS.Timeout | null = null;
    private events: string[] = [];
    private equity: EquityPoint[] = [];
    private modeLabel = "LIVE";
    private usedAltScreen = false;

    start(modeLabel: string): void {
        if (!process.stdout.isTTY || this.running) return;
        this.running = true;
        this.modeLabel = modeLabel;
        // Dedicated screen buffer so logs / other output do not overwrite the dashboard.
        process.stdout.write("\x1B[?1049h");
        this.usedAltScreen = true;
        this.addEvent(`Dashboard started (${modeLabel})`);
        this.render();
        this.renderTimer = setInterval(() => this.render(), 1000);
    }

    stop(): void {
        if (this.renderTimer) clearInterval(this.renderTimer);
        this.renderTimer = null;
        this.running = false;
        if (this.usedAltScreen && process.stdout.isTTY) {
            process.stdout.write("\x1B[?1049l");
            this.usedAltScreen = false;
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

    private truncate(s: string, maxLen: number): string {
        if (s.length <= maxLen) return s;
        return s.slice(0, Math.max(0, maxLen - 1)) + "…";
    }

    private render(): void {
        if (!this.running) return;

        const cols = Math.max(40, process.stdout.columns || 80);
        const rows = Math.max(15, process.stdout.rows || 24);
        const width = Math.min(cols, 120);
        const inner = Math.max(20, width - 2);

        const stats = getStats();
        const now = new Date();
        const title = this.truncate(`POLYMARKET BOT DASHBOARD | ${this.modeLabel} | ${now.toLocaleTimeString()}`, inner);
        const divider = "─".repeat(width);

        // Reserve vertical space: events stay visible (not pushed below fold).
        const reservedForHeader = 8;
        const maxEventLines = Math.max(4, Math.min(12, rows - reservedForHeader));
        const displayedEvents = this.events.slice(-maxEventLines);
        const recent =
            displayedEvents.length > 0
                ? displayedEvents.map((e) => ` ${this.truncate(e, inner)}`).join("\n")
                : " (no events yet)";

        const pnl = this.getPnlSummary();
        const tradesLine = this.truncate(
            `Trades | detected: ${stats.tradesDetected} | copied: ${stats.tradesCopied} | skipped: ${stats.tradesSkipped} | failed: ${stats.tradesFailed}`,
            inner
        );
        const equityLine = this.truncate(
            `Equity | latest: $${pnl.latest.toFixed(2)} | start: $${pnl.start.toFixed(2)} | pnl: ${pnl.delta >= 0 ? "+" : ""}$${pnl.delta.toFixed(2)} (${pnl.pct >= 0 ? "+" : ""}${pnl.pct.toFixed(2)}%)`,
            inner
        );

        const chartLines = this.renderEquityChartCompact(inner, rows);
        const lines = [
            divider,
            ` ${title}`,
            divider,
            " RECENT EVENTS",
            recent,
            divider,
            ` ${tradesLine}`,
            ` ${equityLine}`,
            divider,
            " ASSET (USDC)",
            ...chartLines.map((l) => ` ${this.truncate(l, inner)}`),
            divider,
        ];

        // Clear visible buffer and home cursor (works reliably vs Form Feed on Windows).
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

    /** At most 2 short lines so events are not pushed off-screen. */
    private renderEquityChartCompact(innerWidth: number, termRows: number): string[] {
        if (this.equity.length === 0) return ["(no samples yet)"];
        if (this.equity.length === 1) {
            const v = this.equity[0].value;
            return [`$${v.toFixed(2)} USDC (chart after 2+ samples)`];
        }

        const maxChars = Math.max(24, Math.min(innerWidth, 56, termRows > 20 ? 56 : 40));
        const points = this.equity.slice(-maxChars).map((p) => p.value);
        const min = Math.min(...points);
        const max = Math.max(...points);
        const blocks = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

        if (max === min) {
            return [`${"▅".repeat(Math.min(points.length, maxChars))}  flat @ $${min.toFixed(2)}`];
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

        return [sparkline, `min $${min.toFixed(2)}  max $${max.toFixed(2)}`];
    }
}

export const dashboard = new TerminalDashboard();
