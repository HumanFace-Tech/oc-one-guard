# Decision-model formats for oc-one-guard

**Research date: 2026-10-28**

This report assesses whether the plugin should move from its current `choice` decision question to another decision format, and what evidence would be needed before changing that policy. It separates facts confirmed in this repository, claims made by publishers, analytical inferences, proposals, and topics not evaluated. It does not change runtime behavior or define new configuration fields.

## Executive summary

- The guard's original choice of System One `choice` predates the repository's first recovered commit (`024218d`). The available project history does not show a comparative trial. No source reviewed here establishes that one response format is universally superior for this guard.
- Current policy asks one `choice` question. `src/guard.js` derives a probability from the option identified by `denyLabel`. It does not use the returned winning choice or `confidence`. The default criteria contain `allow`, `deny`, and `escalate`, but the guard does not read the `escalate` probability as a separate policy signal. It uses configured thresholds on the `deny` probability.
- `noul`, `choice`, and `score` do not mean interchangeable forms of the same output. A `noul` probability is normally P(true), `choice` reports a probability distribution over named criteria, and `score` reports an expected ordinal level. An expected score does not identify a violation probability unless a documented mapping and policy make it one.
- The configured System One endpoint receives rendered tool state, which may include arguments and staged file content. The endpoint is configurable and must be trusted. The current request is a System One JSON contract at `/v1/systemone`, not an OpenAI chat-completions request. An arbitrary `model` value in the request may not select a different model already loaded by the server.
- The Jev Decision Index is useful ecosystem context, not a controlled comparison of the three formats for this plugin. Its index combines private tests and new-domain tasks on a public scale; its 37 public benchmarks cover five areas. Its private items are unavailable. Public benchmark scores are visible but excluded from the current Full score.
- Published speed figures and benchmark numbers describe specific model, prompt, implementation, quantization, server, hardware, and workload combinations. They are not measurements of this plugin or proof that one format is faster or more accurate for exfiltration detection.
- Recommendation: keep the default unchanged while gathering local evidence. If evaluating alternative formats, make them explicit backend profiles with pinned artifacts, format/prompt, thresholds, and a defined mapping to policy. Run both direct judge tests and end-to-end plugin tests on labeled, representative cases. Do not silently auto-select formats or reinterpret score values.

## Scope and evidence labels

The report addresses typed decision formats at the guard's judge boundary, specifically `noul`, `choice`, and `score` on the System One API. It does not recommend a model, a provider, or a change to the runtime configuration.

Use these labels when reading the claims below:

- **Confirmed local fact** means the claim follows from the current repository source or visible history.
- **Publisher claim** means the information appears in a model author's, service vendor's, or benchmark maintainer's own material. It is not independently reproduced here.
- **Inference** means a conclusion drawn from facts but not directly measured.
- **Proposal** means work an implementation team could choose to do later.
- **Not evaluated** means this research did not collect evidence sufficient to answer the question.

## Existing choice and plugin contract

### The historical decision is not a comparative result

**Confirmed local fact.** The earliest recovered project commit is `024218d` (`feat: add opt-in outbound data exfiltration guard`). Its history shows an existing decision-model integration, not an experiment comparing output formats. The rationale later associated with the three-category answer shape does not demonstrate comparative accuracy, calibration, latency, or false-positive performance.

The repository contains no reproducible, controlled live comparison of the three formats. Its current 84 mock-based tests check program logic and response handling; they do not test model quality, format superiority, or threshold calibration. Anecdotal results from development sessions are not treated as benchmark evidence here. This research did not contact or run a judge endpoint.

### What the code asks and consumes

**Confirmed local fact.** `src/defaults.js` sets the default endpoint to `/v1/systemone`, model id `h1-decision-4b`, `denyThreshold` to `0.75`, `escalateThreshold` to `0.45`, and a first `choice` question named `verdict`. Its criteria are `allow`, `deny`, and `escalate`; `denyLabel` is `deny`.

`src/judge.js` builds a JSON body containing `model`, `state`, and named `questions`, then POSTs it to the configured endpoint. `src/guard.js` evaluates only `config.questions[0]`. It gets the policy probability through `denyProbability()`, then compares that number with the deny and escalation thresholds. The `choice` top label and returned `confidence` are not used to choose the policy outcome. Therefore, the first `choice` answer's `P(deny)` controls both thresholds; `P(escalate)` is not separately interpreted. An escalation result comes from the deny-probability band and is then acted on via `escalateAction`.

This matters for format comparisons: comparing top-label accuracy alone would not measure the actual behavior. The plugin makes a threshold decision from the violation probability associated with `denyLabel`.

### Users already control the judge integration

**Confirmed local fact.** Configuration supports an endpoint, model id, API key or environment variable for the key, timeout, questions and instructions, plus deny/escalation thresholds and actions. `src/config.js` validates those fields and the allowed question types. A user can replace the default question and criteria.

This is a generic System One JSON interface. Do not assume that setting a chat-completions model name, endpoint path, or API key makes an arbitrary OpenAI-compatible chat service work. The server must implement the request and response contract expected by `src/judge.js`, including the relevant answer shape.

The `model` field is sent in the request. **Inference.** Some servers route on that field, while others bind one model at startup or map unknown names to a loaded model. A configuration change to `model` alone may therefore leave the effective model unchanged. Confirm routing from the specific server's documentation or a controlled server test, not by assuming the request field guarantees a switch.

The endpoint receives the rendered state. This can contain tool arguments and, in applicable cases, staged file contents. **The judge request is not redacted.** Redaction applies to selected audit and error output and is best-effort even there. Select an endpoint that is trusted to receive the original sensitive state; see [security and data handling](../security.md).

## The three response types are not interchangeable

### `noul`: affirmative probability

**Confirmed local fact.** In `src/judge.js`, a normal `noul` answer carries a scalar probability for the affirmative label, conventionally `P(true)`. The configured `denyLabel` determines whether that probability is the violation probability or must be complemented. Configuration validation requires exactly the `true` and `false` criteria and a valid `denyLabel`.

The upstream llama.cpp LEV implementation has a specific exception: it reads nine ratings, from 0 (certainly no) to 8 (certainly yes), and returns `sum(p_i * i / 8)`. This is an expected rating normalized to 0-1, not the probability assigned to one binary true label. The plugin treats it as an affirmative signal without a separate LEV-specific calibration step. Do not assume that every server calling its response `noul` has identical semantics without checking its implementation.

### `choice`: probability per named criterion

**Confirmed local fact.** `choice` returns a selected criterion and a probability map keyed by criterion name. The guard reads the value for `denyLabel`. The winning `choice` string is informational for this policy path; a different label can win while the deny probability still crosses a configured threshold.

With the default criteria, `allow`, `deny`, and `escalate` express distinct categories. But the current guard uses only `P(deny)`, not a three-way decision rule over those probabilities. A future change that uses the `escalate` probability would alter policy behavior and requires explicit policy design and security review. It should not be slipped in as a "format fix."

### `score`: expected position on an ordered scale

**Confirmed local fact.** A `score` question supplies text levels, ordered from lowest to highest. Upstream System One describes the result as the expected level, usually computed as `sum(i * p_i)` for zero-based level indices. The guard's `denyProbability()` intentionally returns no violation probability for a `score` question. Configuration requires the first question to be `choice` or `noul`, so `score` can only be an additional question today.

An expected level is not a universal probability of violation. For example, these distributions over levels 0, 1, and 2 both have expectation 1:

| Distribution | Expected level |
|---|---:|
| `P(0)=0.5`, `P(1)=0`, `P(2)=0.5` | 1 |
| `P(0)=0`, `P(1)=1`, `P(2)=0` | 1 |

Yet they represent different uncertainty and tails. If a score is to drive a block decision, the team must define which levels count as violations, how probabilities map to policy, and what threshold applies. That mapping is a policy choice, not a format conversion supplied by the protocol.

### Thresholds do not prove calibration

The configured threshold values are operational cutoffs, not evidence that the underlying model probabilities match real event frequencies. A threshold such as `0.75` means the plugin blocks at a reported deny probability of 0.75 or above. It does not prove that 75% of comparable calls at that value are actually violations.

## What the Decision Index can and cannot tell us

The live [Jev Decision Index](https://multimodalart-jev-decision-index.static.hf.space/index.html) is maintained in the [Hugging Face Space](https://huggingface.co/spaces/multimodalart/jev-decision-index). The source snapshot reviewed here was commit [`9d601482edd1a52242688400ecb3842b507cd975`](https://huggingface.co/spaces/multimodalart/jev-decision-index/commit/9d601482edd1a52242688400ecb3842b507cd975), reported by Hugging Face as updated 2026-10-28 at 15:00:45 UTC.

**Confirmed source description.** The Space README says the current Full score combines private tests of the same skills (60%) and private tasks from new domains (40%), each placed on the public scale. Public results are displayed but do not count in that Full score. It describes a public suite of 37 benchmarks in five areas. The private test questions and new-domain task items are not published.

This is useful for identifying models, public evaluations, and directions for further study. It is not a controlled leaderboard of `noul` versus `choice` versus `score` for this plugin. Formats are entangled with model weights, training, prompt, implementation, and task. A high overall score does not establish low false-positive rates on authentication or deployment calls, nor calibration of the guard's `P(deny)` threshold.

The methodology page includes additional Jev-only calibration and interactive rows beyond the 37 public benchmarks described as the suite. Do not conflate those supplemental rows with the main public suite. The current methodology panel's calibration measure is based on top-option correctness and uses dataset-defined binning. It does not, by itself, establish calibration of the guard's deny probability on its own task distribution.

The site makes JSON artifacts available at the Space's `data/` path: [`index.json`](https://huggingface.co/spaces/multimodalart/jev-decision-index/resolve/main/data/index.json), [`methodology.json`](https://huggingface.co/spaces/multimodalart/jev-decision-index/resolve/main/data/methodology.json), [`v03.json`](https://huggingface.co/spaces/multimodalart/jev-decision-index/resolve/main/data/v03.json) (a legacy filename), [`vision.json`](https://huggingface.co/spaces/multimodalart/jev-decision-index/resolve/main/data/vision.json), and [`own.json`](https://huggingface.co/spaces/multimodalart/jev-decision-index/resolve/main/data/own.json). These files describe leaderboard and methodology data; they are not raw copies of every private test, all prompt traces, or complete model internals. The index page fetches `index.json`, `v03.json`, `vision.json`, and `own.json`; the methodology page fetches `methodology.json`. If using the data for a repeatable analysis, pin the Space commit and record hashes of the exact downloaded files. A moving `main` URL is not a stable research artifact.

The News view tracks ecosystem artifacts and may rank them by a popularity/trending formula. Popularity is not a quality metric. The tracker itself labels its content unofficial and community-maintained; treat model descriptions and reported outcomes according to their linked primary sources.

## Accuracy, latency, and format evidence

### No controlled format-only comparison was found

**Not evaluated.** This research did not find a controlled comparison that holds model weights, prompt intent, labels, input state, serving configuration, and hardware constant while comparing all three formats for exfiltration or tool-call policy decisions. This is an absence of evidence in the sources reviewed, not proof that no such experiment exists.

The distinctions matter. An identical prompt is not always realistic because each format requires a different answer schema and wording. A fair test should preserve task intent and define each format's prompt adaptation in advance. It should also compare like-for-like model and artifact versions, and separate format effects from training and inference implementation.

### Published performance examples are workload-specific

- **Publisher claim.** TypeSafe's [System One and Jev announcement](https://typesafe.ai/blog/introducing-system-one-models-and-jev) reports 70-500 ms end-to-end times for its service. These are vendor figures, not measurements collected for this report or for this plugin. The post also explains its focus on parallel structured decisions and describes its own evaluation setup.
- **Publisher implementation description.** [OpenJev](https://github.com/razorback16/openjev) reads decision outputs directly from model probabilities. Its documentation describes diffusion models with repeated reads under some conditions and other model backends with their own scoring paths. This shows that implementations behind a compatible API may have different compute costs. It does not establish a universal latency ordering by response type.
- **Publisher benchmark.** The [H2O Lightning 4B card](https://huggingface.co/h2oai/h2o-lightning-4b) describes v1.4.1 on an L40S with vLLM 0.30.0 and reports JevBench at 206/231 for its two-way configuration and 202/231 for its one-way configuration. Those are measurements of attention mode and a particular model setup, not a `noul`/`choice`/`score` comparison.
- **Publisher benchmark.** The H2O card reports a single L40S, vLLM 0.30.0 result of 89.7 ms p50 for a three-question request with records of roughly 600-6000 characters, one request at a time. It separately reports single-question two-way p50 results of 28.2 ms and 59.7 ms for input ranges of 100-300 and 800-1200 tokens. These numbers depend on the exact prompt, input length, server, model and hardware. They are not reproduced measurements and should not be projected onto this guard.
- **Implementation fact, not a universal benchmark.** The current [llama.cpp decision server implementation](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/server-decision.cpp) evaluates LEV `choice` with more than one option in two variants: original and reversed option order. It maps the second result back and averages the probabilities. This means extra model evaluation for that path; actual wall-clock impact also depends on serving and batching. It does not prove that `noul` is always faster or that formats alone caused a quality difference.
- **Publisher quantization data.** The [H2O GGUF model card](https://huggingface.co/h2oai/h2o-lightning-4b-gguf) reports quantization results for a fixed H2O model, sample, llama.cpp build, and hardware. Its findings are useful for that artifact and setup, not a universal claim about quantization, calibration, or other models.

Latency depends on more than the response type. Prompt length and question wording, output/readout implementation, quantization, serving backend, batching, cache state, queueing, hardware, and concurrency can all change results. The plugin itself also has a configurable timeout and optional prefilter/cache, so service timings cannot be equated directly with full guard latency.

## Calibration and the policy risk

Calibration asks whether probability values correspond to observed frequencies among comparable examples. If a system emits a deny probability near 0.8 for many similar cases, an ideal calibrated system would see a violation on about 80% of those cases. This is different from accuracy (whether the top label is right) and from ranking quality (whether riskier cases tend to receive higher scores). It is also different from threshold selection, which chooses an acceptable policy tradeoff.

For example, suppose 10,000 calls contain 1% malicious calls. A detector with 99% recall catches 99 of the 100 malicious calls. At a 1% false-positive rate, it also blocks about 99 of the 9,900 benign calls. The resulting blocked set contains roughly as many false blocks as true blocks, or about 50% precision. This is an illustrative base-rate calculation, not a measurement of this model or plugin.

Aggregate calibration is not a guarantee for every subgroup, threshold, or new distribution. Probability sums also do not guarantee calibration. Evaluate the quantity the policy actually consumes, `P(deny)`, on representative labeled examples. Inspect authentication, legitimate deployment, ambiguous destinations, staged payloads, and realistic exfiltration attempts separately.

The literature supports caution about measurement:

- Guo et al. describe confidence calibration and evaluate post-hoc temperature scaling on held-out calibration data. Fitting and reporting on the same test set would leak evaluation data.
- Gneiting and Raftery describe proper scoring rules, including Brier score and log loss, which assess probabilistic forecasts rather than only top-label correctness.
- Nixon et al. discuss expected calibration error (ECE) sensitivity to choices such as bin count and binning method. An ECE number is incomplete without its exact definition and sample.
- Selective-classification work such as Geifman and El-Yaniv frames abstention as a risk-coverage tradeoff. A system that escalates more cases may reduce error among automatically handled cases while lowering automation coverage.
- Ovadia et al. show why uncertainty evaluation under dataset shift matters. Calibration on one set does not ensure calibration on changed inputs or deployment conditions.

The Index's calibration panels are particular dataset and binning procedures. H2O describes 15 equal-width bins for its text data and 10 for image data. Those definitions are dataset-specific, not universal conventions. A "handful of results" can motivate a question, but cannot establish general model performance.

## Recommendation and proposed evaluation

### Recommendation

**Proposal.** Keep the current default `choice` question and policy thresholds until a local comparison demonstrates a better option for the guard's intended risk profile. Do not silently switch formats, automatically select whichever format appears best in a public leaderboard, or treat the first response type supported by a server as equivalent.

If evaluation supports adding options, make the choice explicit through documented backend profiles. A profile should pin the model artifact/version and quantization, server and endpoint contract, response format, task prompt, threshold, and any conversion from the model output to violation probability. These are design fields for a future proposal, not valid settings in the current configuration.

Do not change `choice` policy to use the `escalate` category without focused policy design and security review. The behavior of `P(escalate)` is currently not part of the model-to-policy mapping. Similarly, do not use `score` for allow/block until the level-to-policy mapping, threshold semantics, and treatment of uncertainty are specified and evaluated.

### Next-agent checklist

1. **Define labels and scope.** Assemble examples of legitimate local activity, authentication, tests/builds, approved deployment, ambiguous transfers, staged-file transmission, credential exposure, and exfiltration. Record why each label is allow, deny, or uncertain. Have a second reviewer adjudicate disagreements.
2. **Cover real state.** Include realistic rendered tool arguments and selected staged-file context. The standalone judge sees state text, not the complete plugin's prefilter, host rules, staged-write tracker, cache, or concurrent mutation handling.
3. **Compare explicit prompt variants.** Keep decision intent consistent, but write format-appropriate instructions and criteria. Version every prompt. Do not claim an identical-prompt comparison where the output schema changes the question.
4. **Separate data splits.** Keep train/tuning, calibration, and final test examples separate. Avoid duplicates, prompt-template leakage, and near-identical commands across splits. Use a hidden final set if thresholds or prompts are revised.
5. **Record base rates and uncertainty.** Build a test set with enough benign examples to estimate false positives and enough threat examples to estimate misses. If the test prevalence differs from deployment, report it and explain any prevalence adjustment. Report intervals, not just point estimates. No universal sample count guarantees adequate coverage for every error rate.
6. **Measure the right outcomes.** Report false-positive rate (FPR), recall, precision, false-negative rate, abstention/escalation rate, and the policy confusion matrix. Measure calibration for the violation probability used by the guard, plus Brier or log loss and a fully specified ECE. Show threshold sweeps and risk versus coverage.
7. **Run two tiers.** First run a direct judge comparison with fixed labeled states and no response cache or request coalescing. Then run full-plugin tests that include prefilter, allow/deny tool and host rules, staged-write state, failures, and races. Keep mocked unit tests separate from model evaluation.
8. **Measure latency fairly.** Record warm and cold behavior, disable or explicitly account for cache, run without coalescing for isolated latency, then test representative concurrency separately. Report p50, p95, p99, timeouts/errors, hardware, server/model versions, prompt/input lengths, batch size, and queue conditions.
9. **Pin and preserve artifacts.** Record model and tokenizer revision, quantization and checksum, serving software/version, prompt files, dataset hash and adjudication notes, run command, raw outputs, and scoring script. For external Decision Index material, pin Space commit and downloaded JSON hashes.
10. **Review policy changes.** Treat any changed deny/allow/escalate mapping or threshold as a security behavior change. Add focused tests and document the rationale in an appropriate `docs/adr/` record before changing defaults.

### Open questions for the evaluation owner

- Does the target judge server honor a per-request `model` field or route only among startup-loaded models?
- Which local model artifacts implement each response type, and do their server-side prompts and calibration layers match the advertised protocol semantics?
- Is the decision objective to minimize false blocks, minimize missed exfiltration, or bound one while accepting a specific coverage cost?
- Should uncertainty map to block, allow, or a separate escalation path, and is a human actually available to handle escalation?
- Which input distribution and benign-call base rate represent intended deployment? How will drift and threshold changes be monitored?
- How will a possible second or third question affect latency, context exposure, and reliability when the current implementation uses only the first question for policy?

## Sources reviewed

### Repository sources

- [`src/defaults.js`](../../src/defaults.js), bundled endpoint, model, default question and thresholds.
- [`src/config.js`](../../src/config.js), configuration validation, question type and `denyLabel` requirements.
- [`src/judge.js`](../../src/judge.js), `/v1/systemone` payload, response normalization, and violation probability extraction.
- [`src/guard.js`](../../src/guard.js), first-question selection, threshold policy, failure behavior, and request flow.
- [Project history](../../), first recovered commit `024218d`.
- [Security and data handling](../security.md), state sent to the judge and the plugin's limits.

### Protocol, models, and benchmark materials

- [TypeSafe, "Introducing System One Models & Jev"](https://typesafe.ai/blog/introducing-system-one-models-and-jev). Publisher statements on design, service speed, and evaluation context.
- [OpenJev source repository](https://github.com/razorback16/openjev). Independent implementation and its API/readout documentation.
- [H2O-Lightning-4B model card](https://huggingface.co/h2oai/h2o-lightning-4b). Publisher benchmark, configuration, and serving details.
- [H2O-Lightning-4B GGUF model card](https://huggingface.co/h2oai/h2o-lightning-4b-gguf). Publisher quantization results for its specified artifacts and tests.
- [llama.cpp decision server source](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/server-decision.cpp). Implementation-specific decision readout behavior.
- [Jev Decision Index Space](https://huggingface.co/spaces/multimodalart/jev-decision-index), checked at commit `9d601482edd1a52242688400ecb3842b507cd975`.
- [Decision Index index data](https://huggingface.co/spaces/multimodalart/jev-decision-index/resolve/main/data/index.json), [methodology data](https://huggingface.co/spaces/multimodalart/jev-decision-index/resolve/main/data/methodology.json), and [methodology page](https://huggingface.co/spaces/multimodalart/jev-decision-index/resolve/main/methodology.html).
- [Decision Index News page](https://huggingface.co/spaces/multimodalart/jev-decision-index/resolve/main/news.html), tracker scope and popularity sorting description.

### Calibration and selective prediction

- Guo et al., ["On Calibration of Modern Neural Networks"](https://arxiv.org/abs/1706.04599), 2017.
- Gneiting and Raftery, ["Strictly Proper Scoring Rules, Prediction, and Estimation"](https://doi.org/10.1198/016214506000001437), 2007.
- Nixon et al., ["Measuring Calibration in Deep Learning"](https://arxiv.org/abs/1904.01685), 2019.
- Geifman and El-Yaniv, ["Selective Classification for Deep Neural Networks"](https://arxiv.org/abs/1705.08500), 2017.
- Ovadia et al., ["Can You Trust Your Model's Uncertainty? Evaluating Predictive Uncertainty Under Dataset Shift"](https://arxiv.org/abs/1906.02530), 2019.

The external sources above support only the specific claims attributed to them. This is a focused source review, not a systematic review of every decision-model benchmark, paper, or implementation.
