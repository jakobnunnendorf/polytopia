//! Tests of opinion.rs: each term, the level thresholds and the peace decisions.
use super::*;
use crate::diplomacy::{dip_mut, make_peace};
use crate::state::{claim_territory, create_game, make_unit, NewGameOptions};
use OpinionFactor::*;

const N: i32 = 12;

/// a 12x12 field map, bot tribes 0.. whose capitals sit in the corners ((0,0), (11,11), (0,11),
/// (11,0)) with a radius-1 territory, everything explored, everyone met on turn 0, no units, no
/// diplomacy; Perfection, turn 10 of 30, crazy
fn blank(players: i32) -> GameState {
    let opts = NewGameOptions {
        map_size: Some(N),
        players,
        mode: GameMode::Perfection,
        difficulty: Some(Difficulty::Crazy),
        seed: 3,
        humans: Some(vec![]),
        map_type: None,
        clans: Some(vec![Tribe::Imperius; players as usize]),
        turn_limit: Some(30),
    };
    let mut s = create_game(&opts).unwrap();
    for t in s.tiles.iter_mut() {
        *t = Tile::new(Terrain::Field);
    }
    s.cities.retain(|c| c.capital);
    s.cities.sort_by_key(|c| c.owner);
    let corners = [(0, 0), (N - 1, N - 1), (0, N - 1), (N - 1, 0)];
    for ci in 0..s.cities.len() {
        let (x, y) = corners[ci];
        let id = s.cities[ci].id;
        s.cities[ci].x = x;
        s.cities[ci].y = y;
        s.cities[ci].original_capital_of = Some(s.cities[ci].owner);
        s.tiles[idx(N, x, y)].city_id = Some(id);
        claim_territory(&mut s, ci, 1);
    }
    let ids: Vec<i32> = s.players.iter().map(|p| p.id).collect();
    for p in s.players.iter_mut() {
        p.explored = vec![1; (N * N) as usize];
        p.met = ids.iter().copied().filter(|&o| o != p.id).collect();
        p.met_turns = vec![0; p.met.len()];
        p.embassies.clear();
    }
    s.units.clear();
    s.diplomacy = None;
    s.turn = 10;
    s.current = 0;
    s
}

fn put(s: &mut GameState, owner: i32, x: i32, y: i32) {
    make_unit(s, UnitType::Warrior, owner, Coord::new(x, y), None);
}

fn attack(s: &mut GameState, by: i32, on: i32, turn: i32) {
    dip_mut(s).attacks.push(AttackRecord { by, on, turn });
}

/// the value of one term of bot's opinion of other (0 when absent)
fn term(s: &GameState, bot: i32, other: i32, f: OpinionFactor) -> f64 {
    opinions(s, bot)[other as usize].as_ref().unwrap().reasons.iter().find(|r| r.0 == f).map_or(0.0, |r| r.1)
}

fn close(a: f64, b: f64) -> bool {
    (a - b).abs() < 1e-9
}

#[test]
fn levels_follow_the_game_thresholds() {
    use OpinionLevel::*;
    let cases = [(2.01, Great), (2.0, Decent), (0.51, Decent), (0.5, Indifferent), (0.0, Indifferent), (-0.5, Indifferent), (-0.51, Poor), (-2.0, Poor), (-2.01, Horrible)];
    for (v, l) in cases {
        assert_eq!(opinion_level(v), l, "{v}");
    }
}

#[test]
fn no_opinion_of_tribes_never_met_nor_attacking() {
    let mut s = blank(2);
    s.players[1].met.clear();
    s.players[1].met_turns.clear();
    assert!(opinions(&s, 1)[0].is_none());
    assert_eq!(opinion_value(&s, 1, 0), 0.0);
    assert_eq!(opinion_of(&s, 1, 0), OpinionLevel::Indifferent);
    // an attack makes an opinion even without a meeting
    attack(&mut s, 0, 1, 10);
    assert!(opinions(&s, 1)[0].is_some());
    assert!(term(&s, 1, 0, Violent) < 0.0);
}

#[test]
fn peaceful_grows_after_meeting_and_violent_fades_after_an_attack() {
    let mut s = blank(2);
    // met on turn 0, no attack: counts from turn -4; t = (10 + 4 - 4) / 4 = 2.5, capped at 2
    assert!(close(term(&s, 1, 0, Peaceful), 1.0));
    s.players[1].met_turns = vec![8];
    // t = (10 - 4 - 4) / 4 = 0.5
    assert!(close(term(&s, 1, 0, Peaceful), 0.25));
    s.players[1].met_turns = vec![0];
    for (at, peaceful, violent) in [(10, 0.0, -2.0), (8, 0.0, -1.0), (6, 0.0, 0.0), (5, 0.125, 0.0), (0, 0.75, 0.0)] {
        let mut t = s.clone();
        attack(&mut t, 0, 1, at);
        assert!(close(term(&t, 1, 0, Peaceful), peaceful), "attack on {at}: peaceful {}", term(&t, 1, 0, Peaceful));
        assert!(close(term(&t, 1, 0, Violent), violent), "attack on {at}: violent {}", term(&t, 1, 0, Violent));
    }
    // an attack by the bot itself does not count
    attack(&mut s, 1, 0, 10);
    assert!(close(term(&s, 1, 0, Peaceful), 1.0));
}

#[test]
fn charming_only_toward_humans_on_easy_and_normal() {
    let mut s = blank(2);
    assert_eq!(term(&s, 1, 0, Charming), 0.0);
    s.players[0].bot = false;
    for (d, v) in [(Difficulty::Easy, 4.0), (Difficulty::Normal, 2.0), (Difficulty::Hard, 0.0), (Difficulty::Crazy, 0.0)] {
        s.difficulty = Some(d);
        assert_eq!(term(&s, 1, 0, Charming), v, "{d:?}");
    }
}

#[test]
fn diplomatic_one_per_embassy_direction() {
    let mut s = blank(2);
    assert_eq!(term(&s, 1, 0, Diplomatic), 0.0);
    s.players[0].embassies.push(1);
    assert_eq!(term(&s, 1, 0, Diplomatic), 1.0);
    s.players[1].embassies.push(0);
    assert_eq!(term(&s, 1, 0, Diplomatic), 2.0);
}

#[test]
fn wise_and_foolish_from_shared_friends_enemies_and_broken_treaties() {
    // bot 1, tribe 0, third tribe 2: all at peace with 2
    let mut s = blank(3);
    make_peace(&mut s, 1, 2);
    make_peace(&mut s, 0, 2);
    assert_eq!(term(&s, 1, 0, Wise), 1.0);
    // bot at peace with 2, tribe 0 at war with 2
    let mut t = blank(3);
    make_peace(&mut t, 1, 2);
    attack(&mut t, 0, 2, 10);
    assert_eq!(term(&t, 1, 0, Foolish), -2.0);
    // both at war with 2
    let mut w = blank(3);
    attack(&mut w, 1, 2, 10);
    attack(&mut w, 2, 0, 10);
    assert_eq!(term(&w, 1, 0, Wise), 2.0);
    // bot at war with 2, tribe 0 at peace with 2
    let mut f = blank(3);
    attack(&mut f, 2, 1, 10);
    make_peace(&mut f, 0, 2);
    assert_eq!(term(&f, 1, 0, Foolish), -1.0);
    // a treaty between 0 and 1 broken on turn 8: -4 / (10 - 8 + 1)
    let mut b = blank(2);
    dip_mut(&mut b).broken_turns.push([0, 1, 8]);
    assert!(close(term(&b, 1, 0, Foolish), -4.0 / 3.0));
    b.turn = 30;
    assert!(close(term(&b, 1, 0, Foolish), -4.0 / 23.0));
    // the game ignores a treaty broken on turn 0
    dip_mut(&mut b).broken_turns[0][2] = 0;
    assert_eq!(term(&b, 1, 0, Foolish), 0.0);
    // capped at +2: four players, both at war with the two others
    let mut c = blank(4);
    for x in [2, 3] {
        attack(&mut c, 1, x, 10);
        attack(&mut c, 0, x, 10);
    }
    assert_eq!(term(&c, 1, 0, Wise), 2.0);
}

#[test]
fn war_needs_an_attack_since_the_attackers_last_turn() {
    let mut s = blank(3);
    attack(&mut s, 2, 0, 9);
    // seat 2 attacked on turn 9; on turn 10 with seat 0 or 2 to play, seat 2 has not played again
    assert!(opinion_war(&s, 2, 0));
    s.current = 2;
    assert!(opinion_war(&s, 2, 0));
    // seat 0 attacked on turn 9 and has played turn 10 once seat 1 is on
    let mut t = blank(3);
    attack(&mut t, 0, 2, 9);
    t.current = 1;
    assert!(!opinion_war(&t, 0, 2));
    // never at peace
    make_peace(&mut s, 0, 2);
    assert!(!opinion_war(&s, 2, 0));
}

#[test]
fn threatening_units_on_and_next_to_the_bots_land() {
    // bot 1's capital at (11, 11), its land x, y in 10..=11
    let mut s = blank(2);
    put(&mut s, 0, 10, 10);
    assert_eq!(term(&s, 1, 0, Threatening), -1.0);
    let mut c = blank(2);
    put(&mut c, 0, 11, 11);
    assert_eq!(term(&c, 1, 0, Threatening), -3.0);
    let mut r = blank(2);
    put(&mut r, 0, 9, 9);
    assert_eq!(term(&r, 1, 0, Threatening), -0.5);
    // at peace: 0.2 on the land, nothing next to it
    make_peace(&mut s, 0, 1);
    put(&mut s, 0, 9, 9);
    assert!(close(term(&s, 1, 0, Threatening), -0.2));
    // a unit far away does not count
    let mut f = blank(2);
    put(&mut f, 0, 5, 5);
    assert_eq!(term(&f, 1, 0, Threatening), 0.0);
}

#[test]
fn intrusive_land_next_to_the_bots_and_a_taken_capital() {
    let mut s = blank(2);
    assert_eq!(term(&s, 1, 0, Intrusive), 0.0);
    // tribe 0's city claims two tiles next to bot 1's land
    let c0 = s.cities[0].id;
    s.tiles[idx(N, 9, 9)].territory = Some(c0);
    s.tiles[idx(N, 9, 10)].territory = Some(c0);
    assert!(close(term(&s, 1, 0, Intrusive), -0.2));
    // tribe 0 holds bot 1's first capital: -2 (bot 1 then has no land left to be next to)
    let mut t = blank(2);
    t.cities[1].owner = 0;
    assert!(close(term(&t, 1, 0, Intrusive), -2.0));
}

#[test]
fn powerful_and_weak_from_military_strength() {
    let mut s = blank(2);
    // no units either side: even
    assert_eq!(term(&s, 1, 0, Weak), 0.0);
    assert_eq!(term(&s, 1, 0, Powerful), 0.0);
    // a warrior: 9 x 2 + 10 x 2 + 7 x 1 = 45
    put(&mut s, 1, 6, 6);
    assert!(close(military(&s, 1), 45.0));
    // 45 against 0: advantage min(2, 45 / 1) = 2, weak -1
    assert_eq!(term(&s, 1, 0, Weak), -1.0);
    put(&mut s, 0, 5, 5);
    put(&mut s, 0, 5, 6);
    // 45 against 90: advantage 0.5, powerful +0.5
    assert!(close(term(&s, 1, 0, Powerful), 0.5));
}

#[test]
fn dominating_and_brave_scale_with_the_games_progress() {
    let mut s = blank(3);
    s.turn = 15;
    // progress 15 / 30 = 0.5
    let ranked = standings(&s);
    let rank = (ranked.iter().position(|&p| p == 0).unwrap() + 1) as f64;
    assert!(close(term(&s, 1, 0, Dominating), -4.0 * 0.25 / (rank * rank)));
    // brave: at war with the leader (neither the bot nor the tribe itself)
    let leader = ranked[0];
    let (bot, other) = match leader {
        0 => (1, 2),
        1 => (0, 2),
        _ => (1, 0),
    };
    assert_eq!(term(&s, bot, other, Brave), 0.0);
    attack(&mut s, other, leader, 15);
    assert!(close(term(&s, bot, other, Brave), 0.25));
    // no progress, no brave
    s.turn = 0;
    attack(&mut s, other, leader, 0);
    assert_eq!(term(&s, bot, other, Brave), 0.0);
}

#[test]
fn annoying_for_tribes_not_at_peace_and_the_least_liked() {
    let mut s = blank(3);
    make_peace(&mut s, 1, 2);
    // bot 1 is at peace with one of two: share 0.5 on tribe 0, which is also the lowest (-0.5 more)
    let o = opinions(&s, 1);
    let a0 = o[0].as_ref().unwrap().reasons.iter().find(|r| r.0 == Annoying).unwrap().1;
    assert!(close(a0, -1.0), "{a0}");
    assert!(o[2].as_ref().unwrap().reasons.iter().all(|r| r.0 != Annoying));
    // at peace with nobody: share 0, only the least liked gets -0.5
    let t = blank(3);
    let o = opinions(&t, 1);
    let total: f64 = o.iter().flatten().flat_map(|x| x.reasons.iter()).filter(|r| r.0 == Annoying).map(|r| r.1).sum();
    assert!(close(total, -0.5));
}

#[test]
fn total_is_the_sum_and_factors_list_the_shown_terms() {
    let mut s = blank(3);
    attack(&mut s, 0, 1, 10);
    s.players[0].embassies.push(1);
    let o = opinions(&s, 1)[0].clone().unwrap();
    let sum: f64 = o.reasons.iter().map(|r| r.1).sum();
    assert!(close(sum, o.total));
    assert!(close(opinion_value(&s, 1, 0), o.total));
    let shown = o.shown();
    assert!(shown.iter().all(|r| r.1.abs() > 0.1));
    assert!(shown.windows(2).all(|w| w[0].1.abs() >= w[1].1.abs()));
    assert_eq!(opinion_factors(&s, 1, 0), shown.iter().map(|r| r.0).collect::<Vec<_>>());
    assert_eq!(shown[0].0, Violent);
    for (f, v) in shown {
        assert_eq!(f.positive(), v > 0.0, "{f:?} {v}");
    }
}

#[test]
fn peace_decisions() {
    assert!(accepts_peace(2.01));
    assert!(!accepts_peace(2.0));
    let mut s = blank(2);
    let r = peace_roll(&s, 1, 0);
    assert!((0.0..1.0).contains(&r));
    assert_eq!(r, peace_roll(&s.clone(), 1, 0));
    assert_eq!(offers_peace(&s, 1, 0, 3.0), 3.0 * r > 2.0);
    assert!(!offers_peace(&s, 1, 0, 2.0));
    // the roll changes from turn to turn
    let rolls: Vec<f64> = (0..10)
        .map(|t| {
            s.turn = t;
            peace_roll(&s, 1, 0)
        })
        .collect();
    assert!(rolls.windows(2).any(|w| w[0] != w[1]));
    // break: -500 x opinion, minus 200 per own unit inside their borders; never at 0 or above
    let mut b = blank(2);
    make_peace(&mut b, 0, 1);
    assert_eq!(break_peace_score(&b, 1, 0, 0.0), 0.0);
    assert_eq!(break_peace_score(&b, 1, 0, -1.0), 500.0);
    put(&mut b, 1, 0, 1);
    assert_eq!(break_peace_score(&b, 1, 0, -1.0), 300.0);
    assert_eq!(aggression_of(-1.5), 1500);
    assert_eq!(aggression_of(0.0004), 0);
}

#[test]
fn meetings_and_broken_treaties_record_their_turn() {
    let mut s = blank(2);
    s.players[1].met.clear();
    s.players[1].met_turns.clear();
    s.turn = 7;
    crate::state::meet(&mut s, 1, 0);
    assert_eq!(first_meet_turn(&s, 1, 0), Some(7));
    let back = crate::json::state_from_json(&crate::json::state_to_json(&s)).unwrap();
    assert_eq!(first_meet_turn(&back, 1, 0), Some(7));
    // turns out of step with `met` count as turn 0
    s.players[1].met_turns.clear();
    assert_eq!(first_meet_turn(&s, 1, 0), Some(0));
    let mut d = Diplomacy::default();
    d.broken_turns.push([0, 1, 9]);
    s.diplomacy = Some(d);
    assert_eq!(last_peace_broken_turn(&s, 1, 0), Some(9));
    let back = crate::json::state_from_json(&crate::json::state_to_json(&s)).unwrap();
    assert_eq!(last_peace_broken_turn(&back, 0, 1), Some(9));
}

#[test]
fn bots_decide_peace_by_opinion() {
    use crate::bot::{score_action, GreedyWeights};
    let w = GreedyWeights::default_weights();
    let mut s = blank(2);
    s.current = 1;
    // peaceful +1, dominating and annoying below 0: not above 2
    let v = opinion_value(&s, 1, 0);
    assert!(v < 2.0, "{v}");
    assert!(score_action(&s, &Action::AcceptPeace { player: 0 }, &w) < 0.0);
    assert!(score_action(&s, &Action::DeclinePeace { player: 0 }, &w) > 0.0);
    // a human on easy: charming +4, above 2
    s.players[0].bot = false;
    s.difficulty = Some(Difficulty::Easy);
    assert!(opinion_value(&s, 1, 0) > 2.0);
    assert!(score_action(&s, &Action::AcceptPeace { player: 0 }, &w) > 0.0);
    assert!(score_action(&s, &Action::DeclinePeace { player: 0 }, &w) < 0.0);
    // breaking peace: only below 0
    make_peace(&mut s, 0, 1);
    assert!(score_action(&s, &Action::BreakPeace { player: 0 }, &w) < 0.0);
    s.difficulty = Some(Difficulty::Crazy);
    s.players[0].bot = true;
    s.turn = 30;
    let v = opinion_value(&s, 1, 0);
    assert!(v < 0.0, "{v}");
    assert!(close(score_action(&s, &Action::BreakPeace { player: 0 }, &w), -v * 500.0));
}

#[test]
fn bots_attack_harder_the_less_they_like_the_target() {
    use crate::bot::{score_action, GreedyWeights};
    let w = GreedyWeights::default_weights();
    let mut s = blank(2);
    s.current = 1;
    put(&mut s, 1, 5, 5);
    put(&mut s, 0, 6, 6);
    let (a, t) = (s.units[0].id, s.units[1].id);
    let act = Action::Attack { unit: a, target: t };
    let r = crate::combat::compute_damage_rounded(&s, &s.units[0], &s.units[1]);
    let base = if r.damage >= s.units[1].hp { w.kill + unit_def(s.units[1].ty).cost as f64 } else { w.hit + r.damage as f64 - r.retaliation as f64 };
    assert!(base > 0.0);
    let v = opinion_value(&s, 1, 0);
    let want = base * (1.0 + aggression_of(v) as f64 * 0.001);
    assert!(close(score_action(&s, &act, &w), want));
    // liked (a human on easy): the attack is no longer worth it
    s.players[0].bot = false;
    s.difficulty = Some(Difficulty::Easy);
    assert!(opinion_value(&s, 1, 0) > 1.0);
    assert!(score_action(&s, &act, &w) <= 0.0);
}
