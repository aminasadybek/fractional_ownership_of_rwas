"""Plot the baseline vault's exit cost against the number of share owners.

Reads:  data/exit_cost_vs_owners.csv   (written by scripts/measure_gas.js)
Writes: figures/exit_cost_vs_owners.png

Run:    python scripts/plot_exit_cost.py
"""

import csv
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # no display needed
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "exit_cost_vs_owners.csv"
OUT = ROOT / "figures" / "exit_cost_vs_owners.png"


def main() -> None:
    owners, transfers, redeem = [], [], []
    with DATA.open(newline="") as f:
        for row in csv.DictReader(f):
            owners.append(int(row["owners"]))
            transfers.append(int(row["transfer_gas_total"]) / 1e3)
            redeem.append(int(row["redeem_gas"]) / 1e3)

    total = [t + r for t, r in zip(transfers, redeem)]

    # Numeric x-axis (not categorical) so the linear growth is shown honestly.
    fig, ax = plt.subplots(figsize=(6, 4), dpi=200)
    ax.plot(owners, total, marker="o", color="#4C72B0", label="Total (transfers + redeem)")
    ax.plot(owners, redeem, marker="s", color="#DD8452", label="redeem() only")

    ax.set_xlabel("Number of share owners (equal split)")
    ax.set_ylabel("Gas used (thousands)")
    ax.set_title("Baseline vault: gas to re-collect all shares and redeem")
    ax.legend(frameon=False)
    ax.spines[["top", "right"]].set_visible(False)
    fig.tight_layout()

    OUT.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(OUT)
    print(f"Wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
