import { createServer } from 'node:http';
import { privateKeyToAccount } from 'viem/accounts';
const PICKER_KEY = process.env.RFQ_PICKER_PRIVATE_KEY?.trim() as `0x${string}`;
const TOKEN = process.env.RFQ_TOKEN?.trim()!;;
const PREMIUM = BigInt(process.env.RFQ_PREMIUM_RAW ?? '5000000'); // 5 USDG (6 desimal)
const picker = privateKeyToAccount(PICKER_KEY);

createServer(async (req, res) => {
  if (
    req.method !== 'POST' ||
    req.headers.authorization !== `Bearer ${TOKEN}`
  ) {
    res.writeHead(401).end();
    return;
  }
  let body = '';
  for await (const c of req) body += c;
  const r = JSON.parse(body);

  const minPremium = BigInt(r.minPremium);
  const premium = PREMIUM > minPremium ? PREMIUM : minPremium;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);

  const signature = await picker.signTypedData({
    domain: {
      name: 'EspalierHarvestAuction',
      version: '1',
      chainId: Number(r.chainId),
      verifyingContract: r.auction,
    },
    types: {
      Quote: [
        { name: 'vault', type: 'address' },
        { name: 'picker', type: 'address' },
        { name: 'round', type: 'uint64' },
        { name: 'strikeE18', type: 'uint256' },
        { name: 'expiry', type: 'uint64' },
        { name: 'notional', type: 'uint256' },
        { name: 'premium', type: 'uint256' },
        { name: 'deadline', type: 'uint64' },
      ],
    },
    primaryType: 'Quote',
    message: {
      vault: r.vault,
      picker: picker.address,
      round: BigInt(r.round),
      strikeE18: BigInt(r.strikeE18),
      expiry: BigInt(r.expiry),
      notional: BigInt(r.notional),
      premium,
      deadline,
    },
  });

  res.setHeader('content-type', 'application/json');
  res.end(
    JSON.stringify({
      quotes: [
        {
          picker: picker.address,
          premium: premium.toString(),
          deadline: deadline.toString(),
          signature,
        },
      ],
    }),
  );
}).listen(8787, '127.0.0.1');
