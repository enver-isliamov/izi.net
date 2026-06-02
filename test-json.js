const xrayStr = '{"routing": {"rules": [{"type":"field","outboundTag":"direct","domain":["domain:ru"]},{"type":"field","outboundTag":"block","domain":["geosite:category-ads-all"]}]},"dns":{"servers":["1.1.1.1"]}}';

const parsedObj = { xraySetting: xrayStr };
const xrayConfig = JSON.parse(parsedObj.xraySetting || '{}');

xrayConfig.routing.rules = xrayConfig.routing.rules.filter(r => !r.izinet_managed);

const finalRules = [{ type: "field", outboundTag: "direct", domain: ["domain:su"], izinet_managed: true }];
xrayConfig.routing.rules = [...finalRules, ...xrayConfig.routing.rules];

xrayConfig.dns.servers = ["localhost", "1.1.1.1"];

const originalXrayStr = JSON.stringify(JSON.parse(parsedObj.xraySetting || '{}'));
const newXrayStr = JSON.stringify(xrayConfig);

console.log("Match?", originalXrayStr === newXrayStr);

const savedXrayStr = newXrayStr;
const parsedObj2 = { xraySetting: savedXrayStr };
const xrayConfig2 = JSON.parse(parsedObj2.xraySetting || '{}');

xrayConfig2.routing.rules = xrayConfig2.routing.rules.filter(r => !r.izinet_managed);
xrayConfig2.routing.rules = [...finalRules, ...xrayConfig2.routing.rules];
xrayConfig2.dns.servers = ["localhost", "1.1.1.1"];

console.log("Match second time?", JSON.stringify(JSON.parse(parsedObj2.xraySetting)) === JSON.stringify(xrayConfig2));
