"use client";

import Link from "next/link";

const Home = () => {
  return (
    <div className="flex items-center flex-col grow pt-10 animate-fade-in">
      <div className="px-5 text-center max-w-3xl">
        {/* Hero */}
        <p className="text-sm font-semibold tracking-widest uppercase opacity-60 mb-4">
          Private Payments Protocol
        </p>
        <h1 className="text-5xl font-bold mb-4 text-gradient">
          StealthPay
        </h1>
        <p className="text-lg opacity-70 mb-2 max-w-xl mx-auto">
          Send and receive tokens privately on Starknet using stealth addresses.
          No on-chain link between sender and recipient.
        </p>
        <p className="text-sm opacity-40 mb-10">
          Adapted from the ERC-5564 stealth address standard for the STARK curve.
        </p>

        {/* How It Works */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mt-6 mb-12 stagger">
          <div className="glass-card rounded-2xl p-6 text-center animate-fade-in">
            <div className="step-circle mx-auto mb-4">1</div>
            <h3 className="font-bold text-lg mb-2">Register</h3>
            <p className="text-sm opacity-60 leading-relaxed">
              Generate your stealth keypairs and publish your public
              meta-address on-chain.
            </p>
          </div>

          <div className="glass-card rounded-2xl p-6 text-center animate-fade-in">
            <div className="step-circle mx-auto mb-4">2</div>
            <h3 className="font-bold text-lg mb-2">Send</h3>
            <p className="text-sm opacity-60 leading-relaxed">
              Send tokens to a one-time stealth address. No visible link
              between sender and recipient.
            </p>
          </div>

          <div className="glass-card rounded-2xl p-6 text-center animate-fade-in">
            <div className="step-circle mx-auto mb-4">3</div>
            <h3 className="font-bold text-lg mb-2">Receive</h3>
            <p className="text-sm opacity-60 leading-relaxed">
              Scan announcements with your viewing key. Claim payments by
              proving ownership of the stealth private key.
            </p>
          </div>
        </div>

        {/* CTA Buttons */}
        <div className="flex gap-4 justify-center mb-14">
          <Link href="/register" className="btn btn-primary btn-lg px-8">
            Get Started
          </Link>
          <Link href="/send" className="btn btn-outline btn-lg px-8">
            Send Payment
          </Link>
        </div>

        {/* Divider */}
        <div className="divider-gradient mb-8" />

        {/* Tech Stack */}
        <div className="glass-card rounded-2xl p-6 mb-8">
          <h3 className="font-semibold text-sm tracking-wide uppercase opacity-50 mb-4">
            Built With
          </h3>
          <div className="flex flex-wrap gap-2 justify-center">
            <span className="badge badge-outline badge-lg">Cairo</span>
            <span className="badge badge-outline badge-lg">STARK Curve</span>
            <span className="badge badge-outline badge-lg">Poseidon Hash</span>
            <span className="badge badge-outline badge-lg">ECDSA</span>
            <span className="badge badge-outline badge-lg">ERC-5564</span>
            <span className="badge badge-outline badge-lg">Starknet Sepolia</span>
          </div>
        </div>

        {/* Hackathon Badge */}
        <div className="opacity-40 text-xs mb-8">
          <p>
            Built for the Starknet Re&#123;define&#125; Hackathon 2026
            &middot; Privacy + Bitcoin Track
          </p>
        </div>
      </div>
    </div>
  );
};

export default Home;
