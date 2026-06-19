// Additive patch for the shared xtracker workflow "taruh data mentah (by wa/app)".
// Adds an AUTOTOKO- branch to Switch1 -> HTTP node that calls AutoToko's
// /api/auth/wa-login/verify. Leaves xtracker's XTRACKER- and raw-data branches
// intact; only tightens the raw-data ("no") rule so AUTOTOKO- doesn't leak in.
// Usage: node patch-wa-login.cjs <in.json> <out.json>
const fs = require("fs");
const crypto = require("crypto");

const [, , inFile, outFile] = process.argv;
const secret = (fs
  .readFileSync("/home/ubuntu/apps/autotoko/.env", "utf8")
  .match(/^WA_WEBHOOK_SECRET=(.*)$/m) || [])[1];
if (!secret) {
  console.error("WA_WEBHOOK_SECRET not found in autotoko .env");
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(inFile, "utf8"));
const doc = Array.isArray(raw) ? raw[0] : raw;

const sw = doc.nodes.find((n) => n.name === "Switch1");
if (!sw) { console.error("Switch1 node not found"); process.exit(1); }
const rules = sw.parameters.rules.values;
if (rules.some((r) => r.outputKey === "autotoko")) {
  console.error("Already patched (autotoko rule exists) — aborting");
  process.exit(2);
}

const body = "={{ $json.messages[0].text.body }}";

// 1) new rule: contains AUTOTOKO-  (becomes output index 2)
rules.push({
  conditions: {
    options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 3 },
    conditions: [{
      id: crypto.randomUUID(),
      leftValue: body, rightValue: "AUTOTOKO-",
      operator: { type: "string", operation: "contains" },
    }],
    combinator: "and",
  },
  renameOutput: true, outputKey: "autotoko",
});

// 2) tighten the raw-data ("no") rule: also require notContains AUTOTOKO-
const noRule = rules.find((r) => r.outputKey === "no");
if (noRule) {
  noRule.conditions.conditions.push({
    id: crypto.randomUUID(),
    leftValue: body, rightValue: "AUTOTOKO-",
    operator: { type: "string", operation: "notContains" },
  });
  noRule.conditions.combinator = "and";
}

// 3) new HTTP node -> AutoToko verify (reachable from n8n via host gateway)
const httpNode = {
  parameters: {
    method: "POST",
    url: "http://172.18.0.1:8090/api/auth/wa-login/verify",
    sendHeaders: true,
    headerParameters: { parameters: [{ name: "x-webhook-secret", value: secret }] },
    sendBody: true,
    specifyBody: "json",
    jsonBody: '={ "code": "{{ $json.messages[0].text.body }}", "wa_number": "+{{ $json.messages[0].from }}" }',
    options: {},
  },
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.4,
  position: [sw.position[0] + 240, sw.position[1] - 150],
  id: crypto.randomUUID(),
  name: "Auth AutoToko",
};
doc.nodes.push(httpNode);

// 4) connect Switch1 output index 2 -> Auth AutoToko
const main = doc.connections["Switch1"].main;
while (main.length < 3) main.push([]);
main[2] = [{ node: "Auth AutoToko", type: "main", index: 0 }];

fs.writeFileSync(outFile, JSON.stringify(Array.isArray(raw) ? [doc] : doc, null, 2));
console.log(`patched OK: rules=${rules.length}, switch1 outputs=${main.length}, added node "Auth AutoToko"`);
