"use client";

import Link from "next/link";

const Home = () => {
  return (
    <div className="flex items-center flex-col grow pt-10">
      <div className="px-5 text-center max-w-3xl">
        {/* Hero */}
        <h1 className="text-5xl font-bold mb-4">
          🔒 StealthPay
        </h1>
        <p className="text-2xl opacity-80 mb-2">
          Private Payments on Starknet
        </p>
        <p className="text-sm opacity-50 mb-8">
          Stealth address protocol adapted for the STARK curve. Send tokens to
          one-time addresses that only the recipient can discover and claim.
        </p>

        {/* How It Works */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8 mb-12">
          <div className="card bg-base-100 shadow-xl border border-gradient">
            <div className="card-body items-center text-center">
              <div className="text-4xl mb-2">🔑</div>
              <h3 className="card-title text-lg">1. Register</h3>
              <p className="text-sm opacity-70">
                Generate your stealth keypairs and register your public
                meta-address on-chain.
              </p>
            </div>
          </div>

          <div className="card bg-base-100 shadow-xl border border-gradient">
            <div className="card-body items-center text-center">
              <div className="text-4xl mb-2">📤</div>
              <h3 className="card-title text-lg">2. Send</h3>
              <p className="text-sm opacity-70">
                Send tokens to a one-time stealth address. No visible link
                between sender and recipient on-chain.
              </p>
            </div>
          </div>

          <div className="card bg-base-100 shadow-xl border border-gradient">
            <div className="card-body items-center text-center">
              <div className="text-4xl mb-2">📥</div>
              <h3 className="card-title text-lg">3. Receive</h3>
              <p className="text-sm opacity-70">
                Scan announcement events with your viewing key. Claim payments
                by proving ownership of the stealth private key.
              </p>
            </div>
          </div>
        </div>

        {/* CTA Buttons */}
        <div className="flex gap-4 justify-center mb-12">
          <Link href="/register" className="btn btn-primary btn-lg">
            Get Started →
          </Link>
          <Link href="/send" className="btn btn-outline btn-lg">
            Send Payment
          </Link>
        </div>

        {/* Tech Stack */}
        <div className="bg-base-200 rounded-2xl p-6 mb-8">
          <h3 className="font-bold text-lg mb-3">Built With</h3>
          <div className="flex flex-wrap gap-3 justify-center">
            <span className="badge badge-lg">Cairo</span>
            <span className="badge badge-lg">STARK Curve</span>
            <span className="badge badge-lg">Poseidon Hash</span>
            <span className="badge badge-lg">ECDSA Signatures</span>
            <span className="badge badge-lg">ERC-5564 Inspired</span>
            <span className="badge badge-lg">Starknet Sepolia</span>
          </div>
        </div>

        {/* Hackathon Badge */}
        <div className="opacity-60 text-sm">
          <p>
            Built for the Starknet Re&#123;define&#125; Hackathon 2026 —
            Privacy + Bitcoin Track
          </p>
        </div>
      </div>
    </div>
  );
};

export default Home;
