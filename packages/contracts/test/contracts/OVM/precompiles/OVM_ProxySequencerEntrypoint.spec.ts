import { expect } from '../../../setup'

/* External Imports */
import { ethers, waffle } from 'hardhat'
import { ContractFactory, Contract, Wallet, constants } from 'ethers'
import { MockContract, smockit } from '@eth-optimism/smock'
import { remove0x } from '@eth-optimism/core-utils'

/* Internal Imports */
import { decodeSolidityError } from '../../../helpers'
import { getContractFactory } from '../../../../src'

const callPredeploy = async (
  Helper_PredeployCaller: Contract,
  predeploy: Contract,
  functionName: string,
  functionParams?: any[]
): Promise<any> => {
  return Helper_PredeployCaller.callPredeploy(
    predeploy.address,
    predeploy.interface.encodeFunctionData(functionName, functionParams || [])
  )
}

const addrToBytes32 = (addr: string) =>
  '0x' + '00'.repeat(12) + remove0x(addr.toLowerCase())

describe('OVM_ProxySequencerEntrypoint', () => {
  let wallet: Wallet
  before(async () => {
    const provider = waffle.provider
    ;[wallet] = provider.getWallets()
  })

  let Factory__OVM_ProxySequencerEntrypoint: ContractFactory
  before(async () => {
    Factory__OVM_ProxySequencerEntrypoint = await ethers.getContractFactory(
      'OVM_ProxySequencerEntrypoint'
    )
  })

  let Mock__OVM_ExecutionManager: MockContract
  let Helper_PredeployCaller: Contract
  let OVM_SequencerEntrypoint: Contract
  before(async () => {
    Mock__OVM_ExecutionManager = await smockit(
      await ethers.getContractFactory('OVM_ExecutionManager')
    )

    Mock__OVM_ExecutionManager.smocked.ovmCALLER.will.return.with(
      await wallet.getAddress()
    )

    Mock__OVM_ExecutionManager.smocked.ovmEXTCODESIZE.will.return.with(0)
    Mock__OVM_ExecutionManager.smocked.ovmCHAINID.will.return.with(420)

    Helper_PredeployCaller = await (
      await ethers.getContractFactory('Helper_PredeployCaller')
    ).deploy()

    Helper_PredeployCaller.setTarget(Mock__OVM_ExecutionManager.address)

    OVM_SequencerEntrypoint = await getContractFactory(
      'OVM_SequencerEntrypoint',
      wallet,
      true
    ).deploy()
  })

  let OVM_ProxySequencerEntrypoint: Contract
  beforeEach(async () => {
    OVM_ProxySequencerEntrypoint = await Factory__OVM_ProxySequencerEntrypoint.deploy()
  })
  it(`should init the proxy with owner and implementation`, async () => {
    Mock__OVM_ExecutionManager.smocked.ovmSLOAD.will.return.with(
      `0x${'00'.repeat(32)}`
    )
    await callPredeploy(
      Helper_PredeployCaller,
      OVM_ProxySequencerEntrypoint,
      'init',
      [OVM_SequencerEntrypoint.address, await wallet.getAddress()]
    )
    const ovmSSTOREs: any = Mock__OVM_ExecutionManager.smocked.ovmSSTORE.calls

    expect(ovmSSTOREs[0]._key).to.equal(`0x${'00'.repeat(31)}01`)
    expect(ovmSSTOREs[0]._value).to.equal(
      addrToBytes32(await wallet.getAddress())
    )

    expect(ovmSSTOREs[1]._key).to.equal(`0x${'00'.repeat(32)}`)
    expect(ovmSSTOREs[1]._value).to.equal(
      addrToBytes32(OVM_SequencerEntrypoint.address)
    )

    // expect(await OVM_ProxySequencerEntrypoint.implementation()).to.equal(
    //   OVM_SequencerEntrypoint.address
    // )
  })
  it(`should revert if proxy has already been inited`, async () => {
    Mock__OVM_ExecutionManager.smocked.ovmSLOAD.will.return.with(
      addrToBytes32(await wallet.getAddress())
    )
    await callPredeploy(
      Helper_PredeployCaller,
      OVM_ProxySequencerEntrypoint,
      'init',
      [constants.AddressZero, constants.AddressZero]
    )

    const ovmREVERT: any = Mock__OVM_ExecutionManager.smocked.ovmREVERT.calls[0]
    expect(decodeSolidityError(ovmREVERT._data)).to.equal(
      'ProxySequencerEntrypoint has already been inited'
    )
  })

  it(`should allow owner to upgrade Entrypoint`, async () => {
    Mock__OVM_ExecutionManager.smocked.ovmSLOAD.will.return.with(
      addrToBytes32(await wallet.getAddress())
    )
    await callPredeploy(
      Helper_PredeployCaller,
      OVM_ProxySequencerEntrypoint,
      'upgrade',
      [`0x${'12'.repeat(20)}`]
    )

    const ovmSSTORE: any = Mock__OVM_ExecutionManager.smocked.ovmSSTORE.calls[0]
    expect(ovmSSTORE._key).to.equal(`0x${'00'.repeat(32)}`)
    expect(ovmSSTORE._value).to.equal(addrToBytes32(`0x${'12'.repeat(20)}`))
  })

  it(`should revert if non-owner tries to upgrade Entrypoint`, async () => {
    Mock__OVM_ExecutionManager.smocked.ovmSLOAD.will.return.with(
      `0x${'00'.repeat(32)}`
    )
    await callPredeploy(
      Helper_PredeployCaller,
      OVM_ProxySequencerEntrypoint,
      'upgrade',
      [`0x${'12'.repeat(20)}`]
    )
    const ovmREVERT: any = Mock__OVM_ExecutionManager.smocked.ovmREVERT.calls[0]
    expect(decodeSolidityError(ovmREVERT._data)).to.equal(
      'Only owner can upgrade the Entrypoint'
    )
  })

  it(`successfully calls ovmCREATEEOA through Entrypoint fallback`, async () => {
    Mock__OVM_ExecutionManager.smocked.ovmSLOAD.will.return.with(
      addrToBytes32(OVM_SequencerEntrypoint.address)
    )
    Mock__OVM_ExecutionManager.smocked.ovmDELEGATECALL.will.return.with([
      true,
      '0x',
    ])
    const calldata = '0xdeadbeef'
    await Helper_PredeployCaller.callPredeploy(
      OVM_ProxySequencerEntrypoint.address,
      calldata
    )
    const ovmDELEGATECALL: any =
      Mock__OVM_ExecutionManager.smocked.ovmDELEGATECALL.calls[0]
    expect(ovmDELEGATECALL._address).to.equal(OVM_SequencerEntrypoint.address)
    expect(ovmDELEGATECALL._calldata).to.equal(calldata)
  })
})
