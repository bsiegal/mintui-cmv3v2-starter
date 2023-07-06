'use client';

import Image from 'next/image'
import styles from './page.module.css'

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from "react";

import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import { WalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { LedgerWalletAdapter, SolflareWalletAdapter} from "@solana/wallet-adapter-wallets";
import "@solana/wallet-adapter-react-ui/styles.css";

import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { base58PublicKey,
  generateSigner,
  Option,
  PublicKey,
  publicKey,
  SolAmount,
  some,
  transactionBuilder,
  Umi,
  unwrapSome
} from "@metaplex-foundation/umi";
import { walletAdapterIdentity } from "@metaplex-foundation/umi-signer-wallet-adapters";
import { setComputeUnitLimit } from '@metaplex-foundation/mpl-essentials';
import { mplTokenMetadata, TokenStandard } from "@metaplex-foundation/mpl-token-metadata";
import { mplCandyMachine, 
  fetchCandyMachine, 
  mintV2, 
  safeFetchCandyGuard, 
  DefaultGuardSetMintArgs, 
  DefaultGuardSet, 
  SolPayment, 
  CandyMachine, 
  CandyGuard } from "@metaplex-foundation/mpl-candy-machine";

export default function Home() {

  const network = process.env.NEXT_PUBLIC_NETWORK === 'devnet' ? WalletAdapterNetwork.Devnet :
    process.env.NEXT_PUBLIC_NETWORK === 'testnet' ? WalletAdapterNetwork.Testnet :
    WalletAdapterNetwork.Mainnet;

  const endpoint = `https://${process.env.NEXT_PUBLIC_RPC_URL}`;

  const wallets = useMemo(
    () => [
      new LedgerWalletAdapter(),
      new SolflareWalletAdapter({ network }),
    ],
    [network]
  );

  const WalletMultiButtonDynamic = dynamic(
    async () =>
      (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
    { ssr: false }
  );

  // set up umi
  let umi: Umi = createUmi(endpoint)
    .use(mplTokenMetadata())
    .use(mplCandyMachine());

  // state
  const [loading, setLoading] = useState(false);
  const [mintCreated, setMintCreated] = useState<PublicKey | null>(null);
  const [mintMsg, setMintMsg] = useState<string>();
  const [costInSol, setCostInSol] = useState<number>(0);
  const [cmv3v2, setCandyMachine] = useState<CandyMachine>();
  const [defaultCandyGuardSet, setDefaultCandyGuardSet] = useState<CandyGuard<DefaultGuardSet>>();
  const [countTotal, setCountTotal] = useState<number>();
  const [countRemaining, setCountRemaining] = useState<number>();
  const [countMinted, setCountMinted] = useState<number>();
  const [mintDisabled, setMintDisabled] = useState<boolean>(true);

  // retrieve item counts to determine availability and
  // from the solPayment, display cost on the Mint button
  const retrieveAvailability = async () => {
    const cmId = process.env.NEXT_PUBLIC_CANDY_MACHINE_ID;
    if (!cmId) {
      setMintMsg("No candy machine ID found. Add environment variable.");
      return;
    }
    const candyMachine: CandyMachine = await fetchCandyMachine(umi, publicKey(cmId));
    setCandyMachine(candyMachine);

    // Get counts
    setCountTotal(candyMachine.itemsLoaded);
    setCountMinted(Number(candyMachine.itemsRedeemed));
    const remaining = candyMachine.itemsLoaded - Number(candyMachine.itemsRedeemed)
    setCountRemaining(remaining);
    
    // Get cost
    const candyGuard = await safeFetchCandyGuard(umi, candyMachine.mintAuthority);
    if (candyGuard) {
      setDefaultCandyGuardSet(candyGuard);
    }
    const defaultGuards: DefaultGuardSet | undefined = candyGuard?.guards;
    const solPaymentGuard: Option<SolPayment> | undefined = defaultGuards?.solPayment;

    if (solPaymentGuard) {
      const solPayment: SolPayment | null  = unwrapSome(solPaymentGuard);
      if (solPayment) {
        const lamports: SolAmount = solPayment.lamports;
        const solCost = Number(lamports.basisPoints) / 1000000000;
        setCostInSol(solCost);
      }
    }

    if (remaining > 0) {
      setMintDisabled(false);
    }
  };

  useEffect(() => {
    retrieveAvailability();
  }, [mintCreated]);

  // Inner Mint component to handle showing the Mint button,
  // and mint messages
  const Mint = () => {
    const wallet = useWallet();
    umi = umi.use(walletAdapterIdentity(wallet));

    // check wallet balance
    const checkWalletBalance = async () => {
      const balance: SolAmount = await umi.rpc.getBalance(umi.identity.publicKey);
      if (Number(balance.basisPoints) / 1000000000 < costInSol) {
        setMintMsg("Add more SOL to your wallet.");
        setMintDisabled(true);
      } else {
        if (countRemaining !== undefined && countRemaining > 0) {
          setMintDisabled(false);
        }
      }
    };
  
    if (!wallet.connected) {
      return <p>Please connect your wallet.</p>;
    } 

    checkWalletBalance();

    const mintBtnHandler = async () => {
  
      if (!cmv3v2 || !defaultCandyGuardSet) {
        setMintMsg("There was an error fetching the candy machine. Try refreshing your browser window.");
        return;
      }
      setLoading(true);
      setMintMsg(undefined);
  
      try {
        const candyMachine = cmv3v2;
        const candyGuard = defaultCandyGuardSet;
  
        const nftSigner = generateSigner(umi);
        
        const mintArgs: Partial<DefaultGuardSetMintArgs> = {};
  
        // solPayment has mintArgs
        const defaultGuards: DefaultGuardSet | undefined = candyGuard?.guards;
        const solPaymentGuard: Option<SolPayment> | undefined = defaultGuards?.solPayment;
        if (solPaymentGuard) {
          const solPayment: SolPayment | null  = unwrapSome(solPaymentGuard);
          if (solPayment) {
            const treasury = solPayment.destination;
  
            mintArgs.solPayment = some({
              destination: treasury
            });
          }
        }
        
        const tx = transactionBuilder()
          .add(setComputeUnitLimit(umi, { units: 600_000 }))
          .add(mintV2(umi, {
            candyMachine: candyMachine.publicKey,
            collectionMint: candyMachine.collectionMint, 
            collectionUpdateAuthority: candyMachine.authority, 
            nftMint: nftSigner,
            candyGuard: candyGuard?.publicKey,
            mintArgs: mintArgs,
            tokenStandard: TokenStandard.ProgrammableNonFungible
          }))
  
  
        const { signature } = await tx.sendAndConfirm(umi, {
          confirm: { commitment: "finalized" }, send: {
            skipPreflight: true,
          },
        });
  
        setMintCreated(nftSigner.publicKey);
        setMintMsg("Mint was successful!");
  
      } catch (err: any) {
        console.error(err);
        setMintMsg(err.message);
      } finally {
        setLoading(false);
      }
    };
  
    if (mintCreated) {
      return (
        <a className={styles.success} target="_blank" rel="noreferrer"
          href={`https://solscan.io/token/${base58PublicKey(mintCreated)}${network === 'devnet' ? '?cluster=devnet' : ''}`}>
          <Image className={styles.logo} src="/nftHolder.png" alt="Blank NFT" width={300} height={300} priority/>
          <p className="mintAddress">
            <code>{base58PublicKey(mintCreated)}</code>
          </p>
        </a>
      );
    }

    return (
      <>          
        <button onClick={mintBtnHandler} className={styles.mintBtn} disabled={mintDisabled || loading}>
          MINT<br/>({costInSol} SOL)
        </button>
        {loading && (<div className={styles.loadingDots}>. . .</div>)}
      </> 
    );
  }; // </Mint>

  return (
    <WalletProvider wallets={wallets} autoConnect>
      <WalletModalProvider>
        <main className={styles.main}>
          <WalletMultiButtonDynamic/>
        
          <h1>Mint Demo by <a href="https://porcupineplaygroundpals.com/how-to-create-a-minting-ui-for-collection-deployed-with-metaplexs-sugar-2-1-1/" target="_blank" rel="noreferrer">Porcupine Playground Pals</a></h1>
          
          <Image className={styles.logo} src="/preview.gif" alt="Preview of NFTs" width={300} height={300} priority/>

          <div className={styles.countsContainer}>
            <div>Minted: {countMinted} / {countTotal}</div>
            <div>Remaining: {countRemaining}</div>
          </div>
          <Mint/>
          {mintMsg && (
            <div className={styles.mintMsg}>
              <button className={styles.mintMsgClose} onClick={() => {setMintMsg(undefined);}}>&times;</button>
              <span>{mintMsg}</span>
            </div>)} 
        </main>
      </WalletModalProvider>
    </WalletProvider>
  )
}

