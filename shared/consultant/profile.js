import { userText } from "./text.js";

export function readProfile(messages) {
  const text = userText(messages);
  const profile = {
    pose: "",
    firm: "",
    child: /ребен|детск|малыш|бобек|бөбек|для сына|для доч/.test(text),
    hot: /жарко|потею|потеет|летом|не греет/.test(text),
    neck: /(^|[^а-я])ше(я|ю|и|ей)([^а-я]|$)|шейн/.test(text),
    storage: /ящик|белье|подъем/.test(text),
    size: "",
    weight: 0
  };
  if (/на боку|на бок|боком/.test(text)) profile.pose = "side";
  else if (/на спине|на спину/.test(text)) profile.pose = "back";
  else if (/на животе|на живот/.test(text)) profile.pose = "stomach";
  if (/жестк|жестч|тверд|тверж|хард/.test(text)) profile.firm = "hard";
  else if (/мягк|мягч|провал/.test(text)) profile.firm = "soft";
  else if (/средн/.test(text)) profile.firm = "medium";
  // The gap after «вес»/«рост» must not cross a comma or full stop, or «вес 100 кг, кровать 180х200» loses the 180.
  const weight = text.match(/(\d{2,3})\s*кг/) || text.match(/(?:^|[^а-я])(?:вес|весом|вешу)(?![а-я])[^\d,.;!?]{0,12}(\d{2,3})(?!\d)/);
  if (weight) profile.weight = Number(weight[1]);
  if (profile.weight >= 95 && !profile.firm) profile.firm = "hard";
  const sizeSource = text
    .replace(/(^|[^а-я])(рост|вес|весом|вешу|возраст)(?![а-я])[^\d,.;!?]{0,12}\d+/g, " ")
    .replace(/\d+\s*(кг|килограм|лет|год|тыс|тг|тенге|₸)/g, " ")
    .replace(/\d{4,}/g, " ");
  const size = sizeSource.match(/(?:^|\D)(80|90|120|140|160|180|200)(?!\d)\s*(?:[xх×*]|на)?\s*(160|180|190|200|210)?(?!\d)/);
  if (size) {
    profile.size = size[1];
    profile.sizeText = size[2] ? `${size[1]}×${size[2]}` : size[1];
  } else if (/двуспаль/.test(text)) profile.size = "180";
  else if (/полутор/.test(text)) profile.size = "140";
  else if (/односпаль/.test(text)) profile.size = "90";
  return profile;
}

export function needsLine(profile, messages) {
  const all = userText(messages);
  const parts = [];
  if (/кроват/.test(all)) parts.push("кровать");
  if (/матрас/.test(all) || profile.pose || profile.firm) parts.push("матрас");
  if (/подуш/.test(all)) parts.push("подушка");
  if (profile.child) parts.push("для ребёнка");
  if (profile.pose === "side") parts.push("сплю на боку");
  if (profile.pose === "back") parts.push("сплю на спине");
  if (profile.pose === "stomach") parts.push("сплю на животе");
  if (profile.firm === "hard") parts.push("хочу жёстче");
  if (profile.firm === "soft") parts.push("люблю помягче");
  if (profile.weight) parts.push(`вес около ${profile.weight} кг`);
  if (profile.size) parts.push(`размер ${profile.sizeText || profile.size}`);
  return [...new Set(parts)].join(", ");
}
