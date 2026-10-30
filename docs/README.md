# Documentation

Start with the GitHub-native [Markdown explainer](explainer.md) for the short version, or [preview the visual walkthrough](https://htmlpreview.github.io/?https://github.com/HumanFace-Tech/oc-one-guard/blob/main/docs/explainer.html) through third-party HTMLPreview. You can also open [the HTML file](explainer.html) locally without using a preview service. The practical guides are here:

- [Installation](installation.md) - register the plugin explicitly and recover if it blocks work.
- [Configuration](configuration.md) - configuration sources, precedence, fields, and decision thresholds.
- [Security and data handling](security.md) - what the plugin sends, stores, and cannot protect against.
- [Contributing](contributing.md) - development checks and review expectations.
- [Architecture decisions](adr/README.md) - accepted decisions and their tradeoffs.
- [Decision-model formats research](research/decision-model-formats-report.md) - dated research on `noul`, `choice`, and `score`; its policy recommendation is superseded by ADR 0007.
- [E02 direct-judge evaluation](research/e02-external-evaluation.md) - historical comparison with the previous default, including the repeated scores and evaluation limits.
- [Prompt-policy search](research/prompt-policy-search.md) - synthetic 20-candidate comparison and its repeat; [candidate definitions](research/prompt-candidates.json).
- [H2O Lightning synthetic evaluation](research/h2o-synthetic-evaluation.md) - one synthetic 100-case run, with its limits and benign blocks.
- [Release checklist](release-checklist.md) - small, explicit follow-ups for testing, npm distribution, and compatibility.

The [root README](../README.md) is the quick introduction. Runtime behavior and tests remain the source of truth.
