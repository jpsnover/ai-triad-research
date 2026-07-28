MAXDEV = 0.35
BASE = {
    "confrontation": {"urgency":0.30,"fear":0.20,"hope":0.17,"outrage":0.17,"empathy":0.14},
    "argumentation": {"urgency":0.20,"fear":0.12,"hope":0.30,"outrage":0.09,"empathy":0.24},
    "concluding":    {"urgency":0.25,"fear":0.08,"hope":0.39,"outrage":0.04,"empathy":0.29},
}
WEIGHTS = {"urgency":0.20,"fear":0.30,"hope":0.10,"outrage":0.30,"empathy":0.10}

# For appropriateness >= T: meanDev <= MAXDEV*(1-T)  =>  sum|dev| <= 5*MAXDEV*(1-T)
# Best case (profile proportional to baseline, scaled to total S < sumBase):
#   sum|dev| = sumBase - S   =>  S >= sumBase - 5*MAXDEV*(1-T)
print("Minimum TOTAL unweighted affect intensity S needed to reach a target,")
print("assuming the profile is distributed PERFECTLY proportional to the baseline:\n")
for T in (0.60, 0.70, 0.80):
    print(f"  target {T:.2f}:")
    for ph, b in BASE.items():
        sumBase = sum(b.values())
        budget = 5 * MAXDEV * (1 - T)
        need = sumBase - budget
        print(f"    {ph:14s} sumBase={sumBase:.2f} sum|dev| budget={budget:.3f} -> need S >= {need:.3f}")
    print()

# What S do real debates plausibly have? intensity_mean is a WEIGHTED mean (weights sum to 1.0),
# so it is a weighted average of the 5 category scores, not their sum.
print("Observed affect_intensity_mean (weighted, weights sum to 1.0): mean 0.080, range 0.024..0.194")
print("If categories were uniform, each ~0.080 -> unweighted total S ~ 0.40")
print("If affect concentrates in the high-weight categories (fear/outrage, w=0.30 each),")
print("the same weighted mean implies a SMALLER unweighted total.\n")

print("Reachability of the 0.60 target, assuming uniform categories (S=0.40):")
for ph, b in BASE.items():
    sumBase = sum(b.values())
    S = 0.40
    best_sumdev = abs(sumBase - S)          # proportional best case
    best_meandev = best_sumdev / 5
    best_app = max(0.0, 1 - best_meandev / MAXDEV)
    print(f"  {ph:14s} BEST achievable appropriateness = {best_app:.3f}"
          f"  ({'reaches' if best_app >= 0.60 else 'CANNOT reach'} 0.60)")

print("\nAnd that best case requires the debate's affect to be distributed EXACTLY")
print("proportional to the baseline shares. Any deviation from that proportion only")
print("increases sum|dev| and lowers the score further.")
