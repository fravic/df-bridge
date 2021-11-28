// Redis keys
const REDIS_KEY_PREFIX = "df_helm__";

export const ARRIVALS_SUBSCRIBED_ETH_ADDRS_KEY = `${REDIS_KEY_PREFIX}subscribed_eth_addrs_to_iftt_api_keys`;
export const ARRIVALS_LAST_DEPARTURE_TIME_SEEN_KEY = `${REDIS_KEY_PREFIX}last_departure_time_seen`;
