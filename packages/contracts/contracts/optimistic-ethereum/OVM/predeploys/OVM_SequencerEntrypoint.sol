// SPDX-License-Identifier: MIT
// @unsupported: evm
pragma solidity >0.5.0 <0.8.0;

/* Interface Imports */
import { iOVM_ECDSAContractAccount } from "../../iOVM/accounts/iOVM_ECDSAContractAccount.sol";

/* Library Imports */
import { Lib_BytesUtils } from "../../libraries/utils/Lib_BytesUtils.sol";
import { Lib_OVMCodec } from "../../libraries/codec/Lib_OVMCodec.sol";
import { Lib_ECDSAUtils } from "../../libraries/utils/Lib_ECDSAUtils.sol";
import { Lib_ExecutionManagerWrapper } from "../../libraries/wrappers/Lib_ExecutionManagerWrapper.sol";

/**
 * @title OVM_SequencerEntrypoint
 * @dev The Sequencer Entrypoint is a predeploy which, despite its name, can in fact be called by 
 * any account. It accepts a more efficient compressed calldata format, which it decompresses and 
 * encodes to the standard EIP155 transaction format.
 * This contract is the implementation referenced by the Proxy Sequencer Entrypoint, thus enabling
 * the Optimism team to upgrade the decompression of calldata from the Sequencer.
 * 
 * Compiler used: optimistic-solc
 * Runtime target: OVM
 */
contract OVM_SequencerEntrypoint {

    /*********
     * Enums *
     *********/
    
    enum TransactionType {
        NATIVE_ETH_TRANSACTION,
        ETH_SIGNED_MESSAGE
    }


    /*********************
     * Fallback Function *
     *********************/

    /**
     * Uses a custom "compressed" format to save on calldata gas:
     * calldata[00:01]: transaction type (0 == EIP 155, 2 == Eth Sign Message)
     * calldata[01:33]: signature "r" parameter
     * calldata[33:65]: signature "s" parameter
     * calldata[65:66]: signature "v" parameter
     * calldata[66:69]: transaction gas limit
     * calldata[69:72]: transaction gas price
     * calldata[72:75]: transaction nonce
     * calldata[75:95]: transaction target address
     * calldata[95:XX]: transaction data
     */
    fallback()
        external
    {
        TransactionType transactionType = _getTransactionType(Lib_BytesUtils.toUint8(msg.data, 0));

        bytes32 r = Lib_BytesUtils.toBytes32(Lib_BytesUtils.slice(msg.data, 1, 32));
        bytes32 s = Lib_BytesUtils.toBytes32(Lib_BytesUtils.slice(msg.data, 33, 32));
        uint8 v = Lib_BytesUtils.toUint8(msg.data, 65);

        // Remainder is the transaction to execute.
        bytes memory compressedTx = Lib_BytesUtils.slice(msg.data, 66);
        bool isEthSignedMessage = transactionType == TransactionType.ETH_SIGNED_MESSAGE;

        // Grab the chain ID for the current network.
        uint256 chainId;
        assembly {
            chainId := chainid()
        }

        // Need to decompress and then re-encode the transaction based on the original encoding.
        bytes memory encodedTx = Lib_OVMCodec.encodeEIP155Transaction(
            Lib_OVMCodec.decompressEIP155Transaction(
                compressedTx,
                chainId
            ),
            isEthSignedMessage
        );

        address target = Lib_ECDSAUtils.recover(
            encodedTx,
            isEthSignedMessage,
            v,
            r,
            s
        );

        bool isEmptyContract;
        assembly {
            isEmptyContract := iszero(extcodesize(target))
        }

        if (isEmptyContract) {
            // ProxyEOA has not yet been deployed for this EOA.
            bytes32 messageHash = Lib_ECDSAUtils.getMessageHash(encodedTx, isEthSignedMessage);
            Lib_ExecutionManagerWrapper.ovmCREATEEOA(messageHash, v, r, s);
        }

        Lib_OVMCodec.EOASignatureType sigtype;
        if (isEthSignedMessage) {
            sigtype = Lib_OVMCodec.EOASignatureType.ETH_SIGNED_MESSAGE;
        } else {
            sigtype = Lib_OVMCodec.EOASignatureType.EIP155_TRANSACTION;
        }

        iOVM_ECDSAContractAccount(target).execute(
            encodedTx,
            sigtype,
            v,
            r,
            s
        );
    }


    /**********************
     * Internal Functions *
     **********************/

    /**
     * Converts a uint256 into a TransactionType enum.
     * @param _transactionType Transaction type index.
     * @return _txType Transaction type enum value.
     */
    function _getTransactionType(
        uint8 _transactionType
    )
        internal
        returns (
            TransactionType _txType
        )
    {
        if (_transactionType == 0) {
            return TransactionType.NATIVE_ETH_TRANSACTION;
        } if (_transactionType == 2) {
            return TransactionType.ETH_SIGNED_MESSAGE;
        } else {
            revert("Transaction type must be 0 or 2");
        }
    }
}
