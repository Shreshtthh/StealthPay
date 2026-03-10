use contracts::stealth_pay::{IStealthPayDispatcher, IStealthPayDispatcherTrait};
use openzeppelin_testing::declare_and_deploy;
use openzeppelin_token::erc20::interface::{IERC20Dispatcher, IERC20DispatcherTrait};
use openzeppelin_utils::serde::SerializedAppend;
use snforge_std::{CheatSpan, cheat_caller_address};
use starknet::ContractAddress;

// STRK token on Sepolia
const STRK_ADDRESS: felt252 =
    0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d;

// Test user with funds on Sepolia
const OWNER: ContractAddress =
    0x02dA5254690b46B9C4059C25366D1778839BE63C142d899F0306fd5c312A5918
    .try_into()
    .unwrap();

fn deploy_announcer() -> ContractAddress {
    let calldata = array![];
    declare_and_deploy("StealthAnnouncer", calldata)
}

fn deploy_stealth_pay(announcer_address: ContractAddress) -> ContractAddress {
    let mut calldata = array![];
    calldata.append_serde(announcer_address);
    declare_and_deploy("StealthPay", calldata)
}

#[test]
fn test_constructor_sets_announcer() {
    let announcer_addr = deploy_announcer();
    let stealth_pay_addr = deploy_stealth_pay(announcer_addr);

    let dispatcher = IStealthPayDispatcher { contract_address: stealth_pay_addr };

    // Verify announcer is set correctly
    assert(dispatcher.get_announcer() == announcer_addr, 'Wrong announcer');
}

#[test]
fn test_deposit_does_not_exist() {
    let announcer_addr = deploy_announcer();
    let stealth_pay_addr = deploy_stealth_pay(announcer_addr);

    let dispatcher = IStealthPayDispatcher { contract_address: stealth_pay_addr };

    let (token, amount, sender, claimed) = dispatcher.get_deposit(0xdeadbeef);

    let zero_addr: ContractAddress = 0.try_into().unwrap();
    assert(token == zero_addr, 'Token should be zero');
    assert(amount == 0, 'Amount should be zero');
    assert(sender == zero_addr, 'Sender should be zero');
    assert(!claimed, 'Should not be claimed');
}

#[test]
#[should_panic(expected: 'Deposit does not exist')]
fn test_claim_nonexistent_deposit_reverts() {
    let announcer_addr = deploy_announcer();
    let stealth_pay_addr = deploy_stealth_pay(announcer_addr);

    let dispatcher = IStealthPayDispatcher { contract_address: stealth_pay_addr };
    let recipient: ContractAddress = 0x123.try_into().unwrap();

    // Try to claim a deposit that doesn't exist
    dispatcher.claim(0xdeadbeef, 0x111, 0x222, 0x333, recipient);
}

#[test]
#[fork("SEPOLIA_LATEST")]
fn test_send_and_verify_deposit() {
    let announcer_addr = deploy_announcer();
    let stealth_pay_addr = deploy_stealth_pay(announcer_addr);

    let dispatcher = IStealthPayDispatcher { contract_address: stealth_pay_addr };
    let strk_addr: ContractAddress = STRK_ADDRESS.try_into().unwrap();
    let erc20 = IERC20Dispatcher { contract_address: strk_addr };

    let amount: u256 = 500;
    let commitment: felt252 = 0xabcdef;

    // Approve StealthPay to spend STRK
    cheat_caller_address(strk_addr, OWNER, CheatSpan::TargetCalls(1));
    erc20.approve(stealth_pay_addr, amount);

    // Send tokens
    cheat_caller_address(stealth_pay_addr, OWNER, CheatSpan::TargetCalls(1));
    dispatcher.send(commitment, 0xaabb, 0xccdd, 42, strk_addr, amount);

    // Verify deposit was stored
    let (token, stored_amount, sender, claimed) = dispatcher.get_deposit(commitment);
    assert(token == strk_addr, 'Wrong token');
    assert(stored_amount == amount, 'Wrong amount');
    assert(sender == OWNER, 'Wrong sender');
    assert(!claimed, 'Should not be claimed yet');
}

#[test]
#[fork("SEPOLIA_LATEST")]
#[should_panic(expected: 'Commitment already used')]
fn test_duplicate_commitment_reverts() {
    let announcer_addr = deploy_announcer();
    let stealth_pay_addr = deploy_stealth_pay(announcer_addr);

    let dispatcher = IStealthPayDispatcher { contract_address: stealth_pay_addr };
    let strk_addr: ContractAddress = STRK_ADDRESS.try_into().unwrap();
    let erc20 = IERC20Dispatcher { contract_address: strk_addr };

    let amount: u256 = 500;
    let commitment: felt252 = 0xabcdef;

    // First send
    cheat_caller_address(strk_addr, OWNER, CheatSpan::TargetCalls(1));
    erc20.approve(stealth_pay_addr, amount);
    cheat_caller_address(stealth_pay_addr, OWNER, CheatSpan::TargetCalls(1));
    dispatcher.send(commitment, 0xaabb, 0xccdd, 42, strk_addr, amount);

    // Second send with same commitment should fail
    cheat_caller_address(strk_addr, OWNER, CheatSpan::TargetCalls(1));
    erc20.approve(stealth_pay_addr, amount);
    cheat_caller_address(stealth_pay_addr, OWNER, CheatSpan::TargetCalls(1));
    dispatcher.send(commitment, 0xeeff, 0x1122, 43, strk_addr, amount);
}
