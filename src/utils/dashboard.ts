import { getStats } from "../copy-trade/core";

const MAX_EVENTS = 10;
const MAX_EQUITY_POINTS = 60;

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

    start(modeLabel: string): void {
        if (!process.stdout.isTTY || this.running) return;
        this.running = true;
        this.modeLabel = modeLabel;
        this.addEvent(`Dashboard started (${modeLabel})`);
        this.render();
        this.renderTimer = setInterval(() => this.render(), 1000);
    }

    stop(): void {
        if (this.renderTimer) clearInterval(this.renderTimer);
        this.renderTimer = null;
        this.running = false;
    }

    addEvent(message: string): void {
        const line = `${new Date().toLocaleTimeString()} | ${message}`;
        this.events.push(line);
        if (this.events.length > MAX_EVENTS) this.events = this.events.slice(-MAX_EVENTS);
    }

    pushEquity(value: number): void {
        if (!Number.isFinite(value) || value < 0) return;
        this.equity.push({ timestamp: Date.now(), value });
        if (this.equity.length > MAX_EQUITY_POINTS) this.equity = this.equity.slice(-MAX_EQUITY_POINTS);
    }

    private render(): void {
        if (!this.running) return;

        const stats = getStats();
        const now = new Date();
        const title = `POLYMARKET BOT DASHBOARD | ${this.modeLabel} | ${now.toLocaleTimeString()}`;
        const width = Math.max(80, Math.min(process.stdout.columns || 100, 140));
        const divider = "═".repeat(width);
        const chart = this.renderEquityChart(width);
        const recent = this.events.length > 0 ? this.events.map((e) => `  ${e}`).join("\n") : "  (no events yet)";
        const pnl = this.getPnlSummary();

        const lines = [
            divider,
            title,
            divider,
            `Trades | detected: ${stats.tradesDetected} | copied: ${stats.tradesCopied} | skipped: ${stats.tradesSkipped} | failed: ${stats.tradesFailed}`,
            `Equity | latest: $${pnl.latest.toFixed(2)} | start: $${pnl.start.toFixed(2)} | pnl: ${pnl.delta >= 0 ? "+" : ""}$${pnl.delta.toFixed(2)} (${pnl.pct >= 0 ? "+" : ""}${pnl.pct.toFixed(2)}%)`,
            divider,
            "ASSET CHART (recent)",
            chart,
            divider,
            "RECENT EVENTS",
            recent,
            divider,
        ];

        process.stdout.write("\x1Bc");
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

    private renderEquityChart(width: number): string {
        if (this.equity.length < 2) return "  (waiting for equity data...)";

        const chartWidth = Math.max(30, Math.min(width - 10, this.equity.length));
        const points = this.equity.slice(-chartWidth).map((p) => p.value);
        const min = Math.min(...points);
        const max = Math.max(...points);
        const blocks = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

        if (max === min) {
            return `  ${"▅".repeat(points.length)}\n  min=max=$${min.toFixed(2)}`;
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

        return `  ${sparkline}\n  min=$${min.toFixed(2)} max=$${max.toFixed(2)}`;
    }
}

export const dashboard = new TerminalDashboard();
