# RL course final project (EMAI, UPF)

The lecturer's brief is [`final_project.pdf`](final_project.pdf) (copied from the course folder on 2026-11-25).
The working project plan is the Claude Doc "RL final project plan: learning to play Polytopia"
(https://claude.ai/artifact/6tcqFQes2PPSfjZZg1Aiej).

## The brief in short

- 25% of the RL grade; groups of at most 3 students, one shared grade.
- In-person talk: 15 minutes plus 5–10 minutes of Q&A, tentatively in the week of June 22–26 (the brief names no year).
- Written report within one week of the talk; it adds the technical details and answers the Q&A questions.
- One week before the talks, each group enters its details in a spreadsheet the lecturer shares on Google Classroom.
- Focus: problem setup, approach and results, or the difficulties met, everything tried, what worked or failed and why.
- Two kinds of project:
  - **Empirical:** formulate your own problem as an RL problem (a gym environment or an ad-hoc solution; showing the MDP is viable by dynamic programming is fine), solve a hard existing environment, or implement an algorithm from scratch on a simple one (suggested: Q-REPS, arXiv 2010.11151; FOGAS, arXiv 2405.13755).
  - **Literature review:** an RL sub-area not covered in class (ideas: POMDPs, multi-objective and constrained MDPs, structured MDPs, multi-agent RL, inverse RL, off-policy RL, Bayesian RL), tied to the course where possible.

## How this repo answers it

An empirical project on the Shardlands engine (`engine/py` VecEnv, see `docs/shardlands/RL.md`): do the course's
value-based and policy-gradient methods beat the ES-tuned greedy bot at an equal game budget? The candidate
experiments are the `[RL]` issues indexed in #123.
