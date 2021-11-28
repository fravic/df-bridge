import fetch from "isomorphic-fetch";
import { DfArrivalEvent, DfPlanet } from "./types";

const IFTTT_URL = `https://maker.ifttt.com/trigger/{address}/with/key/{apiKey}?value1={body}`;
const BODY_TEMPLATE = "Hostile {energy} arriving at {planetName} in {time}";

export async function notify(
  iftttApiKey: string,
  arrivalEvent: DfArrivalEvent,
  planet: DfPlanet
) {
  // TODO: Fill in template
  const notifBody = BODY_TEMPLATE;
  const iftttUrl = IFTTT_URL.replace("{address}", planet.owner)
    .replace("{apiKey}", iftttApiKey)
    .replace("{body}", notifBody);
  console.log("Sending push to", iftttUrl);
  const res = await fetch(iftttUrl);
}
