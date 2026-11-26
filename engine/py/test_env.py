"""Tests for the polyengine Python module. Run: engine/py/.venv/bin/python engine/py/test_env.py
(build first with engine/py/build.sh)."""
import json
import os
import random
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np  # noqa: E402
import polyengine  # noqa: E402

OPTS = {"mode": "perfection", "mapSize": 11, "players": 2, "mapType": "drylands", "humans": []}
OPTS_JSON = json.dumps(OPTS)
N = 8
SEED = 1234


def call(name, *args):
    r = json.loads(polyengine.call(name, json.dumps(list(args))))
    assert "error" not in r, r
    return r["ok"]


def obs_array(env, b):
    return np.frombuffer(b, dtype=np.float32).reshape(env.n, env.num_channels, env.map_size, env.map_size)


def test_shapes():
    env = polyengine.VecEnv(N, OPTS_JSON, SEED)
    C = len(polyengine.channels())
    assert C == env.num_channels == len(call("CHANNELS"))
    assert env.map_size == 11 and env.players == 2
    o = obs_array(env, env.reset())
    assert o.shape == (N, C, 11, 11), o.shape
    assert o[:, 0].sum() > 0  # something is explored
    sc = np.frombuffer(env.scalars(), dtype=np.float32).reshape(N, -1)
    names = env.scalar_names()
    assert sc.shape == (N, env.num_scalars) and len(names) == env.num_scalars
    assert names == polyengine.scalar_names(2)
    # scalars match observe() through the JSON entry point
    s = json.loads(env.state_json(0))
    want = call("observe", s, 0)
    assert want["scalars"]["stars"] == sc[0, names.index("stars")]
    assert want["scalars"]["score"] == sc[0, names.index("score")]
    planes = np.array(want["planes"], dtype=np.float32).reshape(C, 11, 11)
    assert np.array_equal(planes, o[0])
    counts = env.legal_counts()
    assert len(counts) == N and all(c >= 1 for c in counts)
    for i in range(N):
        la = env.legal_actions(i)
        assert len(la) == counts[i]
        assert [json.dumps(a, separators=(",", ":")) for a in call("legalActions", json.loads(env.state_json(i)))] == la
    print(f"shapes ok: obs {o.shape}, scalars {sc.shape}")


def play(env, steps, policy, rng):
    obs = []
    rewards = []
    dones = 0
    for _ in range(steps):
        if policy == "random":
            choices = [rng.randrange(c) for c in env.legal_counts()]
        else:
            choices = env.bot_choices()
        b, r, d = env.step(choices)
        o = obs_array(env, b)
        assert o.shape[0] == env.n and np.isfinite(o).all()
        assert all(x in (-1.0, 0.0, 1.0) for x in r)
        obs.append(o.copy())
        rewards.append(list(r))
        dones += sum(d)
    return obs, rewards, dones


def test_play_and_determinism():
    for policy in ("random", "bot"):
        a = polyengine.VecEnv(N, OPTS_JSON, SEED)
        b = polyengine.VecEnv(N, OPTS_JSON, SEED)
        oa, ra, da = play(a, 2000, policy, random.Random(7))
        ob, rb, db = play(b, 2000, policy, random.Random(7))
        assert da == db and ra == rb
        assert all(np.array_equal(x, y) for x, y in zip(oa, ob))
        wins = sum(x for row in ra for x in row if x > 0)
        losses = -sum(x for row in ra for x in row if x < 0)
        print(f"{policy}: 2000 steps x {N} envs, {da} episodes ended (learner +{wins:g} / -{losses:g}), deterministic")
        # a different seed gives a different game
        c = polyengine.VecEnv(N, OPTS_JSON, SEED + 1000)
        assert c.state_json(0) != polyengine.VecEnv(N, OPTS_JSON, SEED).state_json(0)


def test_shaping_and_max_turns():
    env = polyengine.VecEnv(4, OPTS_JSON, SEED, shaping=True, max_turns=3)
    total, dones = 0.0, 0
    for _ in range(400):
        _, r, d = env.step(env.bot_choices())
        total += sum(r)
        dones += sum(d)
        for i in range(4):
            assert json.loads(env.state_json(i))["turn"] < 3
    assert dones > 0, "max_turns never ended an episode"
    t = json.loads(env.terminal_state_json(0))
    assert t["turn"] >= 3 or t["over"]
    assert total != 0.0  # score deltas arrive
    print(f"shaping/max_turns ok: {dones} truncated episodes, total shaped reward {total:.3f}")


def test_matches_call_api():
    """the learner playing bot choices = createGame + botStep/applyAction via call()."""
    seed = 99
    env = polyengine.VecEnv(1, OPTS_JSON, seed)
    steps = 0
    while True:
        _, _, d = env.step(env.bot_choices())
        steps += 1
        if d[0]:
            break
        assert steps < 100000
    got = json.loads(env.terminal_state_json(0))
    # the same game through the JSON entry point (VecEnv makes the learner seat the human seat)
    learner = 0
    s = call("createGame", dict(OPTS, seed=seed, humans=[learner]))
    moves = 0
    while not (s["over"] or not s["players"][learner]["alive"]):
        a = call("botStep", s, None)
        s = call("applyAction", s, a)
        moves += 1
    assert got == s, "env game differs from the call() game"
    print(f"call() parity ok: seed {seed}, {steps} learner steps, {moves} actions, final turn {s['turn']}, winner {s['winner']}")


def test_learner_is_human():
    """the learner seat is the only human seat, whatever options_json says: human capital income (+1), not the
    difficulty's bot bonus (crazy +4)."""
    opts = dict(OPTS, players=3, difficulty="crazy")
    for learner, humans in ((0, []), (1, []), (0, [2]), (2, None)):
        o = dict(opts)
        if humans is None:
            o.pop("humans")
        else:
            o["humans"] = humans
        env = polyengine.VecEnv(1, json.dumps(o), 5, learner=learner)
        s = json.loads(env.state_json(0))
        assert [p["bot"] for p in s["players"]] == [p != learner for p in range(3)], (learner, humans)
        checked = set()
        for c in s["cities"]:
            if c["capital"] and c["level"] == 1 and c["pop"] >= 0 and not c["workshop"] and c["parks"] == 0:
                want = 2 if c["owner"] == learner else 5
                assert call("cityIncome", s, c) == want, (learner, humans, c["owner"])
                checked.add(c["owner"])
        assert learner in checked and len(checked) >= 2, checked
    print("learner seat is human ok")


def test_speed():
    for n in (1, 8, 64):
        env = polyengine.VecEnv(n, OPTS_JSON, SEED)
        rng = random.Random(1)
        steps = max(400, 8000 // n)
        t0, c0 = time.perf_counter(), time.process_time()
        for _ in range(steps):
            env.step([rng.randrange(c) for c in env.legal_counts()])
        dt, cpu = time.perf_counter() - t0, time.process_time() - c0
        t0 = time.perf_counter()
        for _ in range(steps // 4):
            env.step(env.bot_choices())
        dt2 = time.perf_counter() - t0
        print(f"speed n={n}: random {steps * n / dt:,.0f} learner steps/s wall ({steps * n / cpu:,.0f} per CPU-second);"
              f" bot-choice {steps // 4 * n / dt2:,.0f} learner steps/s wall"
              " (a step includes the opponent's moves until the learner's next turn)")


if __name__ == "__main__":
    test_shapes()
    test_play_and_determinism()
    test_shaping_and_max_turns()
    test_matches_call_api()
    test_learner_is_human()
    test_speed()
    print("all tests passed")
