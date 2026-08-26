# Theory of Success: Organizations

**Author:** Computational Linguist (AI Triad Research). **Ticket:** t/3045. **Date:** 2026-08-26.

## What an Organization is

An Organization is a real-world institutional actor in the AI policy ecosystem, carrying a per-camp stance profile derived from its public positions: Anthropic (corporate, San Francisco), AI Now Institute (research lab, New York), Andreessen Horowitz (corporate, Menlo Park), Center for AI Safety (advocacy, San Francisco), Electronic Frontier Foundation (civil society), European AI Office (regulatory, Brussels), Future of Life Institute (advocacy). Where Entities are named referents in general, Organizations are the subset that hold and express positions, so the system can map the abstract four-camp model onto who actually argues each side in the world.

Structure (as seen in the Organizations view, about 25 organizations):
- **Type:** corporate, research lab, advocacy, civil society, or regulatory.
- **Identity:** name, short name or acronym (a16z, CAIS, EFF), and location (city, country).
- **Stance profile:** a per-camp alignment across the three camps (accelerationist, safetyist, skeptic), shown as the ACC / SAF / SKE indicators, ideally derived from the organization's public claims rather than asserted.

## The theory of success

The four-camp taxonomy is a model of positions; Organizations are how that model is grounded in reality. Knowing that a claim is "accelerationist" is abstract; knowing that Andreessen Horowitz and the AI Now Institute sit on opposite sides of a specific claim makes the model concrete and checkable against the public record. Organizations turn the taxonomy from a theory of positions into a map of who holds them.

**An Organization succeeds when it is correctly identified and typed, and when its per-camp stance profile is derived from actual matched evidence rather than asserted.** The corpus succeeds when it covers the influential organizations across the ecosystem and each stance is traceable to the public claims that justify it, through a matching process with known precision.

Success criteria, each checkable:
1. **Correct identity.** Name, type, and location match the real organization, with acronyms and aliases resolved.
2. **Evidence-grounded stance.** The per-camp alignment is derived from organization-to-claim matching (public statements matched to taxonomy claims), not stipulated by an annotator.
3. **Matching quality.** The org-claim match gate performs at acceptable precision, and matches are reviewed rather than accepted blind.
4. **Coverage across sectors.** Corporate labs, research institutes, advocacy groups, civil society, and regulators are all represented, so the stance map is not skewed to one sector.
5. **Neutrality.** Stance profiles reflect the evidence, not the annotator's priors, which matters especially because organizations are named and reputationally sensitive.

Failure modes, each a real concern:
- **Ungrounded stance**: labeling an organization accelerationist or safetyist without matched claims behind it, which is both wrong and reputationally risky.
- **Matching false positives**: a single organization absorbing a disproportionate share of claims (org-014 accounted for about 45% of claims in the first batch), which the cross-document family-key rule exists to correct.
- **Coverage gaps or duplicates**: influential organizations missing, or one organization split across two records.
- **Stale stances**: an organization's position shifts and the profile is not refreshed.

## How Organizations are generated

- **Curated and extracted.** The organization list is assembled from the corpus and curated, with type and location attached.
- **Stance via org-claim matching.** `Invoke-OrgClaimMatching` matches an organization's public statements to taxonomy claims by cosine similarity. The current gates are a single-claim threshold of 0.60 cosine and a cross-document-family minimum of 2 claims, where the family key is the source id stripped of its trailing year suffix so a trio of related documents collapses to one unit. This family rule proved load-bearing on the first batch, where org-014 would otherwise have dominated. Proposals are reviewed, and rejections are kept as telemetry by design so the accept rate per cosine band can eventually take the threshold off "stipulated."
- **Profile assembly.** Matched claims aggregate into the per-camp stance indicators.

## How Organizations are used

- **Grounding camp positions.** Organizations show which real institutions hold a given camp position, turning an abstract stance into a concrete example.
- **Stance mapping.** The per-camp alignment lets analysis see where an organization sits and how organizations cluster or oppose.
- **Evidence for debates.** Organizational stances serve as real-world instantiations of camp positions, so a debate can cite who actually argues a side.
- **Browsing and analysis.** The Organizations view supports search and filtering by type and by camp alignment.

## Success metrics and current gaps

- **Stance grounding rate:** the fraction of stance assignments backed by matched claims rather than asserted.
- **Matching precision:** accept rate per cosine band from reviewer decisions, which is the planned path to take the 0.60 threshold off "stipulated" (recorded in the metric provenance register).
- **Open items:** the 0.60 single-claim threshold and the 2-claim family minimum are stipulated pending that review-derived calibration; coverage and dedup are not yet audited against a reference list.
