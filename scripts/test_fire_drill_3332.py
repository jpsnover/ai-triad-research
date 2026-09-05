def test_fire_drill_3332_intentional_fail():
    # t/3332 fire-drill: intentional failure keeps ci-gate red so auto-merge
    # stays queued during the gate test. Remove before merging.
    assert False, "fire-drill t/3332: intentional — remove this file before merging"
