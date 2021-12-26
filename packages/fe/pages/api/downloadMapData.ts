import type { NextApiRequest, NextApiResponse } from "next";

import { getAllChunks } from "../../data";

type Data = Array<any>;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Data>
) {
  const mapData = await getAllChunks();
  res.status(200).json(mapData);
}
