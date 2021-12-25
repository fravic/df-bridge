import * as ethers from "ethers";
import type { NextApiRequest, NextApiResponse } from "next";

import { addSubscribedEthAddr } from "../../data";

type Data = {
  error?: string;
  success: boolean;
};

const NULL_ETH_ADDRESS = "0x0000000000000000000000000000000000000000";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Data>
) {
  if (req.method !== "POST") {
    res
      .status(400)
      .json({ error: "Only POST requests are allowed", success: false });
    return;
  }

  const ethAddress = req.body["ethAddress"];
  const isAddress = ethers.utils.isAddress(ethAddress);
  if (!ethAddress || !isAddress || ethAddress === NULL_ETH_ADDRESS) {
    res
      .status(400)
      .json({ error: "Invalid eth address provided", success: false });
    return;
  }

  const iftttApiKey = req.body["iftttApiKey"];
  if (!iftttApiKey) {
    res
      .status(400)
      .json({ error: "Invalid IFTTT API key provided", success: false });
    return;
  }

  await addSubscribedEthAddr(ethAddress, iftttApiKey);
  res.status(200).json({ success: true });
}
