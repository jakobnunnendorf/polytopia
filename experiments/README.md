# Experiment records without a playable model

Folders under `models/` that hold only `sweep.jsonl` and `train.log` are measurements: a model
re-measured (no knob changed) or a sweep whose best point was not kept. Their model.json is left
out so the app and arena do not list duplicate models. See the experiment's issue for the verdict.
