"""Generate the README pricing comparison chart.

Single-bar comparison at 1M req/mo:
- Spanlens Team: $149/mo
- Langfuse Pro:  $271/mo (Core $29 base + 9 × $8/100K overage)

Style mirrors the previous chart: dark navy background, purple Spanlens bar,
muted gray Langfuse bar, value labels on top of bars, source footer.
"""

import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.ticker import MultipleLocator

plt.rcParams["text.parse_math"] = False

BG = "#0f1424"
PANEL = "#0f1424"
TEXT = "#ffffff"
SUBTLE = "#7a8199"
GRID = "#1f2540"
SPANLENS = "#7c7cff"
LANGFUSE = "#3a4060"
ACCENT = "#7c7cff"

labels = ["Spanlens Team", "Langfuse Pro"]
values = [149, 271]
colors = [SPANLENS, LANGFUSE]

fig, ax = plt.subplots(figsize=(11.4, 6.6), dpi=130)
fig.patch.set_facecolor(BG)
ax.set_facecolor(PANEL)

x = list(range(len(labels)))
bar_width = 0.28
bars = ax.bar(x, values, color=colors, width=bar_width, zorder=3)
ax.set_xlim(-0.7, 1.7)

ax.set_ylim(0, 320)
ax.yaxis.set_major_locator(MultipleLocator(50))
ax.set_yticks([0, 50, 100, 150, 200, 250, 300])
ax.set_yticklabels([f"${v}" for v in [0, 50, 100, 150, 200, 250, 300]])

ax.set_xticks(x)
ax.set_xticklabels(labels)

ax.tick_params(axis="x", colors=SUBTLE, labelsize=12, pad=8, length=0)
ax.tick_params(axis="y", colors=SUBTLE, labelsize=10, length=0)

for spine in ax.spines.values():
    spine.set_visible(False)

ax.grid(axis="y", color=GRID, linewidth=1, zorder=1)
ax.set_axisbelow(True)

for bar, v in zip(bars, values):
    ax.text(
        bar.get_x() + bar.get_width() / 2,
        v + 8,
        f"${v}",
        ha="center", va="bottom",
        color=TEXT, fontsize=18, fontweight="bold",
    )

savings_pct = round((1 - values[0] / values[1]) * 100)
ax.annotate(
    f"{savings_pct}% cheaper",
    xy=(0.18, (values[0] + values[1]) / 2),
    xytext=(0.5, 230),
    color=ACCENT, fontsize=14, fontweight="bold",
    ha="center",
    arrowprops=dict(arrowstyle="-", color=ACCENT, lw=1.2, alpha=0.6),
)

fig.suptitle(
    "1M requests / month, production-grade plan",
    x=0.06, y=0.955,
    ha="left", color=TEXT, fontsize=21, fontweight="bold",
)
fig.text(
    0.06, 0.895,
    "Same alerts, webhooks, team roles. Half the bill.",
    ha="left", color=SUBTLE, fontsize=12,
)

fig.text(
    0.06, 0.045,
    "Source: langfuse.com/pricing (Core $29 + 900K overage @ $8/100K) · spanlens.io/pricing  (May 2026)",
    ha="left", color=SUBTLE, fontsize=9,
)
fig.text(
    0.94, 0.045,
    "spanlens.io",
    ha="right", color=ACCENT, fontsize=11, fontweight="bold",
)

plt.subplots_adjust(left=0.08, right=0.96, top=0.82, bottom=0.14)

out_preview = r"C:\Users\User\Documents\coding\Spanlens\.github\assets\pricing-vs-langfuse.preview.png"
plt.savefig(out_preview, facecolor=BG, dpi=130)
print(f"Saved: {out_preview}")
