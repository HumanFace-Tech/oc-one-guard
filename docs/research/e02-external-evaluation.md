# E02 direct-judge evaluation

**Status: historical research record.** E02 is the current built-in question, but these results are not a validated performance estimate or a guarantee. They compare the former V0 default with E02 on one fixed synthetic fixture through direct judge requests; they do not measure the full plugin.

## Results

The original run made 1,000 requests across ten question conditions on 100 cases. The follow-up made 300 requests across E02, E03, and E04. Both summaries reported zero request errors and the same fixture hash, `8241bfcbdd7361d2df5cbd43a8b9f04ca4f05f542b2d866c43a1c7de5b81d9b1`. At the guard's 0.50 review threshold, the original run recorded:

| Question condition | Benign blocked | Malicious blocked | Malicious missed |
|---|---:|---:|---|
| V0, previous default | 15/53 | 37/37 | none |
| E02, selected default | 3/53 | 32/37 | `auth-06`, `storage-08`, `ssh-06`, `mcp-08`, `web-07` |

E02 blocked 12 fewer benign cases and 5 fewer malicious cases than V0 on this fixture. Choosing E02 accepts lower benign blocking at the cost of those observed malicious misses; it is a less restrictive tradeoff, not an across-the-board improvement. Scores are not calibrated probabilities, and these small fixture counts are not production rates.

All 300 follow-up scores matched the corresponding original scores exactly across E02, E03, and E04. The repeat reused the same cases and questions, so it is not an independent evaluation. Server-side caching was not excluded; exact repeats do not establish independent sampling.

## Scope and limitations

- The summaries report `h2o-lightning-4b`; this is a server-reported model name, not independently verified model weights or revision. No endpoint or machine-local result path is included here.
- These were direct judge calls on reused, synthetic development cases. They did not test the plugin's prefilter, configuration and response handling end to end, execute fixture commands, or include trusted task context. The fixture commands remained inert.
- The 1,000-request run reports its total and per-condition scores. The 300-request repeat reports exact score equality, but neither should be read as independent validation.
- A separate omitted-criteria tournament reported 1,200 scored requests with no errors: 600 requests omitted criteria and 600 supplied them. That establishes raw omission was accepted in that run, not that omission is semantically equivalent to explicit yes/no criteria or that servers share an implicit wording.
- The results do not establish generalization, calibration, recall, or a security boundary. The model may miss a transfer, and available call state may not establish task authorization or the machine's trust boundary.

The selected E02 behavior and its rationale are recorded in [ADR 0009](../adr/0009-e02-default-question.md). For current options and compatibility guidance, see [configuration](../configuration.md).
