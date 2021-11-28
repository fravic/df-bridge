import fetch from "isomorphic-fetch";
import dayjs from "dayjs";

import { DfArrival, DfPlanet } from "./types";

const IFTTT_URL = `https://maker.ifttt.com/trigger/df_helm/with/key/{apiKey}?value1={body}`;
const BODY_TEMPLATE = "Hostile {energy} energy arriving at {planetName} {time}";
const MILLISECONDS_PER_SECOND = 1000;

import relativeTime from "dayjs/plugin/relativeTime";
dayjs.extend(relativeTime);

export async function notifyOfArrival(
  iftttApiKey: string,
  arrival: DfArrival,
  planet: DfPlanet
) {
  const arrivalTime = dayjs(
    arrival.arrivalTime.toNumber() * MILLISECONDS_PER_SECOND
  );
  const notifBody = BODY_TEMPLATE.replace(
    "{energy}",
    arrival.popArriving.toString()
  )
    .replace("{planetName}", `Level ${planet.planetLevel} Planet`)
    .replace("{time}", arrivalTime.fromNow());
  const iftttUrl = IFTTT_URL.replace("{apiKey}", iftttApiKey).replace(
    "{body}",
    notifBody
  );
  console.log("Sending push to", iftttUrl);
  await fetch(iftttUrl);
}
