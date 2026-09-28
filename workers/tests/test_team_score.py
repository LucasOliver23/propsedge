from engine.team_score import book_line, default_line, grade, score


def test_default_line():
    assert default_line(15.6) == 15.5 and default_line(12.3) == 11.5 and default_line(0.9) == 0.5


def test_score_over_strong_series():
    l20 = [18, 23, 14, 16, 20, 17, 19, 21, 15, 18, 16, 22, 13, 17, 19, 20, 15, 18, 16, 21]
    sc, p, comps = score({"l20": l20, "h2h": [17, 19], "venue": [18, 20, 16], "season": l20},
                         14.5, "over", 17.5, 2.5, 1.1)
    assert sc >= 70 and p > 0.7 and "matchup" in comps
    sc_u, _, _ = score({"l20": l20}, 14.5, "under", 17.5, 2.5, 1.1)
    assert sc_u < 40


def test_grade():
    assert grade(1.2, "over") == "A" and grade(1.2, "under") == "F" and grade(None, "over") is None


def test_book_line_is_near_50_50():
    assert book_line(2.4, 1.2) == 2.5      # gols do jogo: 2.5, não 1.5
    assert book_line(0.9, 0.8) == 0.5
    assert book_line(15.6, 3.0) == 15.5    # faltas
    assert book_line(10.2, 2.5) in (9.5, 10.5)
