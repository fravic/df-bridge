import type { NextApiRequest, NextApiResponse } from "next";

import { addSubscribedEthAddr } from "../../data";

type Data = {
  error?: string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Data>
) {
  if (req.method !== "POST") {
    res.status(400).json({ error: "Only POST requests are allowed" });
    return;
  }

  const ethAddress = req.body["ethAddress"];
  if (!ethAddress) {
    res.status(400).json({ error: "Invalid eth address provided" });
    return;
  }

  const iftttApiKey = req.body["iftttApiKey"];
  if (!iftttApiKey) {
    res.status(400).json({ error: "Invalid IFTTT API key provided" });
    return;
  }

  await addSubscribedEthAddr(ethAddress, iftttApiKey);
  res.status(200).json({});
}
