use contracts::stealth_registry::{IStealthRegistryDispatcher, IStealthRegistryDispatcherTrait};
use openzeppelin_testing::declare_and_deploy;
use snforge_std::{CheatSpan, cheat_caller_address};
use starknet::ContractAddress;

const TEST_USER: ContractAddress =
    0x02dA5254690b46B9C4059C25366D1778839BE63C142d899F0306fd5c312A5918
    .try_into()
    .unwrap();

fn deploy_registry() -> ContractAddress {
    let calldata = array![];
    declare_and_deploy("StealthRegistry", calldata)
}

#[test]
fn test_register_and_retrieve() {
    let registry_addr = deploy_registry();
    let dispatcher = IStealthRegistryDispatcher { contract_address: registry_addr };

    let spend_pub_x: felt252 = 0x1234567890abcdef;
    let view_pub_x: felt252 = 0xfedcba0987654321;

    // Register as TEST_USER
    cheat_caller_address(registry_addr, TEST_USER, CheatSpan::TargetCalls(1));
    dispatcher.register(spend_pub_x, view_pub_x);

    // Retrieve and verify
    let (stored_spend, stored_view) = dispatcher.get_meta_address(TEST_USER);
    assert(stored_spend == spend_pub_x, 'Wrong spend key');
    assert(stored_view == view_pub_x, 'Wrong view key');
    assert(dispatcher.is_registered(TEST_USER), 'Should be registered');
}

#[test]
fn test_register_overwrites() {
    let registry_addr = deploy_registry();
    let dispatcher = IStealthRegistryDispatcher { contract_address: registry_addr };

    // First registration
    cheat_caller_address(registry_addr, TEST_USER, CheatSpan::TargetCalls(1));
    dispatcher.register(0x111, 0x222);
    let (s1, v1) = dispatcher.get_meta_address(TEST_USER);
    assert(s1 == 0x111, 'First spend key wrong');
    assert(v1 == 0x222, 'First view key wrong');

    // Re-register with new keys
    cheat_caller_address(registry_addr, TEST_USER, CheatSpan::TargetCalls(1));
    dispatcher.register(0x333, 0x444);
    let (s2, v2) = dispatcher.get_meta_address(TEST_USER);
    assert(s2 == 0x333, 'Updated spend key wrong');
    assert(v2 == 0x444, 'Updated view key wrong');
}

#[test]
fn test_unregistered_returns_zero() {
    let registry_addr = deploy_registry();
    let dispatcher = IStealthRegistryDispatcher { contract_address: registry_addr };

    let random_user: ContractAddress = 0x999.try_into().unwrap();
    let (spend, view) = dispatcher.get_meta_address(random_user);
    assert(spend == 0, 'Unregistered spend should be 0');
    assert(view == 0, 'Unregistered view should be 0');
    assert(!dispatcher.is_registered(random_user), 'Should not be registered');
}

#[test]
#[should_panic(expected: 'spend key cannot be zero')]
fn test_register_zero_spend_key_reverts() {
    let registry_addr = deploy_registry();
    let dispatcher = IStealthRegistryDispatcher { contract_address: registry_addr };
    dispatcher.register(0, 0x123);
}

#[test]
#[should_panic(expected: 'view key cannot be zero')]
fn test_register_zero_view_key_reverts() {
    let registry_addr = deploy_registry();
    let dispatcher = IStealthRegistryDispatcher { contract_address: registry_addr };
    dispatcher.register(0x123, 0);
}
