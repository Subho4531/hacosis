const express = require('express');
const { createUmi } = require('@metaplex-foundation/umi-bundle-defaults');
const { createNft, mplTokenMetadata, TokenStandard } = require('@metaplex-foundation/mpl-token-metadata');
const { generateSigner, createSignerFromKeypair, percentAmount, signerIdentity } = require('@metaplex-foundation/umi');
const bs58 = require('bs58');
const { PublicKey } = require('@solana/web3.js');
const { fetchMetadataFromSeeds } = require('@metaplex-foundation/mpl-token-metadata');

const app = express();
const port = 3000;
app.use(express.json());

const WALLET_PRIVATE_KEY = bs58.decode("3nHVqRv27K4sauPNiTLstfpZbFgLSPjLwhj3cjwEXzjVF6nEN1DWN46t2X6UDCqkvSyd9shhvqmPbbhx4mCNU19y")
const SOLANA_RPC_URL = "https://little-blue-road.solana-devnet.quiknode.pro/1a5408432a7b3e59f40d2b1471e0a3fa4ae9ac25/";

const umi = createUmi(SOLANA_RPC_URL).use(mplTokenMetadata());
const kp = umi.eddsa.createKeypairFromSecretKey(WALLET_PRIVATE_KEY);
const serverSigner = createSignerFromKeypair(umi, kp);
umi.use(signerIdentity(serverSigner));

function convertBigIntToString(obj) {
  if (typeof obj === 'bigint') {
    return obj.toString();
  } else if (Array.isArray(obj)) {
    return obj.map(convertBigIntToString);
  } else if (obj && typeof obj === 'object') {
    const newObj = {};
    for (const key in obj) {
      newObj[key] = convertBigIntToString(obj[key]);
    }
    return newObj;
  }
  return obj;
}

app.post('/api/mint', async (req, res) => {
  try {
    const { userPublicKey, title, description, ipfsUri, tags } = req.body;
    console.log('Mint request:', { userPublicKey, title, description, ipfsUri, tags });
    if (!userPublicKey || typeof userPublicKey !== 'string' || userPublicKey.length < 32) {
      return res.status(400).send('Invalid userPublicKey');
    }
    let userWalletAddress;
    try {
      userWalletAddress = new PublicKey(userPublicKey);
    } catch (e) {
      console.error('Invalid PublicKey:', e);
      return res.status(400).send('Invalid userPublicKey format');
    }
    const mint = generateSigner(umi);
    console.log('About to call createNft().sendAndConfirm()');
    let mintResult;
    try {
      mintResult = await createNft(umi, {
        mint,
        name: title,
        symbol: "ART",
        uri: ipfsUri,
        sellerFeeBasisPoints: percentAmount(5),
        creators: [{ address: umi.identity.publicKey, share: 100, verified: true }],
        tokenOwner: userWalletAddress,
        isMutable: false,
        payer: umi.identity,
        tokenStandard: TokenStandard.NonFungible,
      }).sendAndConfirm(umi);
      console.log('Full mint result:', mintResult);
      let signature =
        mintResult?.signature ||
        mintResult?.response?.signature ||
        mintResult?.txId ||
        mintResult?.transaction;
      if (signature && signature instanceof Uint8Array) {
        signature = bs58.encode(signature);
      }
      if (signature) {
        res.status(200).send({
          message: 'NFT mint transaction submitted!',
          transactionSignature: signature,
          nftAddress: mint.publicKey.toString(),
          tags: tags,
          metadataUri: ipfsUri
        });
      } else {
        console.error('No transaction signature found. Full mint result:', mintResult);
        res.status(500).send('Minting failed. Please check the server console for details.');
      }
    } catch (mintError) {
      console.error('Minting error:', mintError);
      return res.status(500).send({ error: 'Minting failed', details: mintError.message || mintError });
    }
  } catch (error) {
    console.error('Unexpected error:', error);
    res.status(500).send({ error: 'Minting failed due to an unexpected error.', details: error.message || error });
  }
});

app.post('/api/search', async (req, res) => {
  try {
    const { searchInput, searchTags } = req.body;
    const mockNFTs = [
        {
            nftAddress: "B9zYg...NFT_ADDRESS_1",
            metadata: {
                name: "The Grand Waterfall",
                description: "A stunning piece of a majestic waterfall.",
                tags: ["waterfall", "scenery", "nature", "river"]
            }
        },
        {
            nftAddress: "C8zYh...NFT_ADDRESS_2",
            metadata: {
                name: "Sunset Over the City",
                description: "A beautiful cityscape at sunset.",
                tags: ["city", "sunset", "skyline", "buildings"]
            }
        }
    ];
    const results = mockNFTs.filter(nft => 
      nft.metadata.tags.some(tag => searchTags.includes(tag))
    );
    res.status(200).send({
      message: 'Search successful!',
      query: { searchInput, searchTags },
      results: results
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('Search failed.');
  }
});

app.get('/api/nft/:address', async (req, res) => {
  try {
    const { address } = req.params;
    let mintAddress;
    try {
      mintAddress = new PublicKey(address);
    } catch (e) {
      return res.status(400).send({ error: 'Invalid NFT address' });
    }
    const metadata = await fetchMetadataFromSeeds(umi, { mint: mintAddress });
    if (!metadata) {
      return res.status(404).send({ error: 'NFT metadata not found' });
    }
    const safeMetadata = convertBigIntToString(metadata);
    res.status(200).send({
      nftAddress: address,
      metadata: safeMetadata
    });
  } catch (error) {
    console.error('Error fetching NFT metadata:', error);
    res.status(500).send({ error: 'Failed to fetch NFT metadata', details: error.message || error });
  }
});

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});