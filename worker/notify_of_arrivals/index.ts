// Module to notify subscribers of hostile arrivals heading to their planets

import { ApolloClient } from "@apollo/client/core";
import fetch from "isomorphic-fetch";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

import {
  ARRIVALS_SUBSCRIBED_ETH_ADDRS_KEY,
  ARRIVALS_DEPARTURE_TIME_HIGH_WATERMARK_KEY,
} from "../../common/constants";
import { RedisClient } from "../types";
import { ARRIVALS_QUERY } from "./queries";
import * as log from "../../common/log";

const IFTTT_URL = `https://maker.ifttt.com/trigger/df_helm/with/key/{apiKey}?value1={body}`;
const BODY_TEMPLATE = "Hostile {energy} energy arriving at {planetName} {time}";
const MILLISECONDS_PER_SECOND = 1000;
const ARRIVAL_TIME_DELTA_CUTOFF_MINS = 2;
const MAX_ARRIVALS_TO_QUERY = 100;

dayjs.extend(relativeTime);

async function notifyOfArrival(iftttApiKey: string, arrival: any) {
  const arrivalTime = dayjs(arrival.arrivalTime * MILLISECONDS_PER_SECOND);

  // Don't notify of arrival times that happened too far in the past
  if (dayjs().diff(arrivalTime, "minute") > ARRIVAL_TIME_DELTA_CUTOFF_MINS) {
    log.log("Discarding old arrival with time: " + arrivalTime.fromNow(), 2);
    return;
  }

  const notifBody = BODY_TEMPLATE.replace(
    "{energy}",
    arrival.milliEnergyArriving
  )
    .replace("{planetName}", `Level ${arrival.toPlanet.planetLevel} Planet`)
    .replace("{time}", arrivalTime.fromNow());
  const iftttUrl = IFTTT_URL.replace("{apiKey}", iftttApiKey).replace(
    "{body}",
    notifBody
  );
  log.log("Sending push to: " + iftttUrl, 2);
  await fetch(iftttUrl);
}

export async function notifyOfArrivals(
  client: ApolloClient<any>,
  redisClient: RedisClient
) {
  log.verbose("Begin notify of arrivals", 1);
  const departureTimeGtStr = await redisClient.get(
    ARRIVALS_DEPARTURE_TIME_HIGH_WATERMARK_KEY
  );
  const departureTimeGt = departureTimeGtStr ? Number(departureTimeGtStr) : 0;
  const { data, error } = await client.query({
    fetchPolicy: "network-only",
    query: ARRIVALS_QUERY,
    variables: {
      first: MAX_ARRIVALS_TO_QUERY,
      departureTimeGt,
    },
  });
  if (error) {
    log.error("Error querying arrivals: " + error, 2);
    return;
  }
  const arrivals = data?.arrivals;
  if (!arrivals || !arrivals.length) {
    log.verbose("No arrivals returned", 2);
    return;
  }

  const lastDepartureTime = data.arrivals[0].departureTime;
  log.log("Updating latest departure time to: " + lastDepartureTime, 2);
  await redisClient.set(
    ARRIVALS_DEPARTURE_TIME_HIGH_WATERMARK_KEY,
    String(lastDepartureTime)
  );

  log.verbose("Processing arrival count: " + arrivals.length, 2);
  const iftttApiKeysByEthAddress = JSON.parse(
    (await redisClient.get(ARRIVALS_SUBSCRIBED_ETH_ADDRS_KEY)) || "{}"
  );
  const notifyPromises = [];
  for (const arrival of arrivals) {
    log.log("Processing arrival with id: " + arrival.id, 2);
    const planetOwnerId = arrival.toPlanet.owner.id;
    if (arrival.player.id === planetOwnerId) {
      continue;
    }
    const iftttApiKeys = iftttApiKeysByEthAddress[planetOwnerId] || [];
    for (const iftttApiKey of iftttApiKeys) {
      notifyPromises.push(notifyOfArrival(iftttApiKey, arrival));
    }
  }
  log.verbose("Notification promise count: " + notifyPromises.length, 2);
  await Promise.all(notifyPromises);
}
