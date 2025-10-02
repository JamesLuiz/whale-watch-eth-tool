import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import axios from 'axios';
import { PaginationDto, PaginatedResponse } from '../../common/dto/pagination.dto';
import { EthereumUtil } from '../../common/utils/ethereum.util';

@Injectable()
export class TransactionService {
  private readonly logger = new Logger(TransactionService.name);
  private provider: ethers.JsonRpcProvider;
  private etherscanApiKey: string;

  constructor(private configService: ConfigService) {
    const rpcUrl = this.configService.get<string>('ETHEREUM_RPC_URL');
    this.etherscanApiKey = this.configService.get<string>('ETHERSCAN_API_KEY');
    
    if (rpcUrl) {
      this.provider = new ethers.JsonRpcProvider(rpcUrl);
    }
  }

  async getTransactionDetails(hash: string) {
    try {
      if (!this.provider) {
        throw new Error('Ethereum provider not configured');
      }

      const [transaction, receipt] = await Promise.all([
        this.provider.getTransaction(hash),
        this.provider.getTransactionReceipt(hash).catch(() => null),
      ]);

      if (!transaction) {
        throw new NotFoundException('Transaction not found');
      }

      const block = transaction.blockNumber 
        ? await this.provider.getBlock(transaction.blockNumber)
        : null;

      const valueEth = EthereumUtil.formatEther(transaction.value.toString());
      const gasPriceGwei = EthereumUtil.formatGwei(transaction.gasPrice?.toString() || '0');

      return {
        hash: transaction.hash,
        from: transaction.from,
        to: transaction.to,
        value: valueEth,
        gasPrice: gasPriceGwei,
        gasLimit: transaction.gasLimit?.toString(),
        gasUsed: receipt?.gasUsed?.toString(),
        nonce: transaction.nonce,
        data: transaction.data,
        blockNumber: transaction.blockNumber,
        blockHash: transaction.blockHash,
        transactionIndex: transaction.index,
        timestamp: block ? new Date(block.timestamp * 1000) : null,
        status: receipt ? (receipt.status === 1 ? 'success' : 'failed') : 'pending',
        confirmations: transaction.confirmations,
      };
    } catch (error) {
      this.logger.error(`Error getting transaction ${hash}:`, error.message);
      throw error;
    }
  }

  async analyzeTransaction(hash: string) {
    try {
      const details = await this.getTransactionDetails(hash);
      
      const analysis = {
        ...details,
        analysis: {
          isWhaleTransaction: EthereumUtil.isWhaleTransaction(details.value, 50),
          isTokenTransfer: this.isTokenTransfer(details.data),
          methodSignature: this.getMethodSignature(details.data),
          estimatedCost: this.calculateTransactionCost(details),
          tokenTransfer: null,
        },
      };

      // Add token transfer details if applicable
      if (analysis.analysis.isTokenTransfer) {
        analysis.analysis.tokenTransfer = await this.analyzeTokenTransfer(details);
      }

      return analysis;
    } catch (error) {
      this.logger.error(`Error analyzing transaction ${hash}:`, error.message);
      throw error;
    }
  }

  async getAddressTransactions(address: string, paginationDto: PaginationDto) {
    try {
      if (!EthereumUtil.isValidAddress(address)) {
        throw new Error('Invalid Ethereum address');
      }

      if (!this.etherscanApiKey) {
        throw new Error('Etherscan API key not configured');
      }

      const checksumAddress = EthereumUtil.checksumAddress(address);
      const page = paginationDto.page;
      const offset = paginationDto.limit;

      const response = await axios.get('https://api.etherscan.io/api', {
        params: {
          module: 'account',
          action: 'txlist',
          address: checksumAddress,
          startblock: 0,
          endblock: 99999999,
          page,
          offset,
          sort: 'desc',
          apikey: this.etherscanApiKey,
        },
      });

      if (response.data.status !== '1') {
        throw new Error('Failed to fetch transactions from Etherscan');
      }

      const transactions = response.data.result.map(tx => ({
        hash: tx.hash,
        from: tx.from,
        to: tx.to,
        value: EthereumUtil.formatEther(tx.value),
        gasPrice: EthereumUtil.formatGwei(tx.gasPrice),
        gasUsed: tx.gasUsed,
        timestamp: new Date(parseInt(tx.timeStamp) * 1000),
        blockNumber: parseInt(tx.blockNumber),
        status: tx.txreceipt_status === '1' ? 'success' : 'failed',
        isError: tx.isError === '1',
      }));

      // For pagination, we'll estimate total based on the response
      const total = transactions.length === paginationDto.limit ? 
        paginationDto.page * paginationDto.limit + 1 : 
        (paginationDto.page - 1) * paginationDto.limit + transactions.length;

      return new PaginatedResponse(transactions, total, paginationDto.page, paginationDto.limit);
    } catch (error) {
      this.logger.error(`Error getting transactions for address ${address}:`, error.message);
      throw error;
    }
  }

  private isTokenTransfer(data: string): boolean {
    if (!data || data === '0x') return false;
    
    // Check for common token transfer method signatures
    const transferSignatures = [
      '0xa9059cbb', // transfer(address,uint256)
      '0x23b872dd', // transferFrom(address,address,uint256)
      '0x095ea7b3', // approve(address,uint256)
    ];

    return transferSignatures.some(sig => data.startsWith(sig));
  }

  private getMethodSignature(data: string): string | null {
    if (!data || data === '0x' || data.length < 10) return null;
    
    const signature = data.slice(0, 10);
    const knownSignatures = {
      '0xa9059cbb': 'transfer(address,uint256)',
      '0x23b872dd': 'transferFrom(address,address,uint256)',
      '0x095ea7b3': 'approve(address,uint256)',
      '0x': 'ETH Transfer',
    };

    return knownSignatures[signature] || signature;
  }

  private calculateTransactionCost(details: any): string {
    try {
      if (!details.gasUsed || !details.gasPrice) return '0';
      
      const gasCostWei = (BigInt(details.gasUsed) * BigInt(EthereumUtil.parseUnits(details.gasPrice, 9))).toString();
      return EthereumUtil.formatEther(gasCostWei);
    } catch (error) {
      return '0';
    }
  }

  private async analyzeTokenTransfer(details: any) {
    try {
      if (!this.isTokenTransfer(details.data)) return null;

      // Decode token transfer data
      const data = details.data;
      const methodSig = data.slice(0, 10);

      if (methodSig === '0xa9059cbb') { // transfer
        const to = '0x' + data.slice(34, 74);
        const amount = BigInt('0x' + data.slice(74, 138));

        return {
          method: 'transfer',
          to,
          amount: amount.toString(),
          contractAddress: details.to,
        };
      }

      return {
        method: this.getMethodSignature(data),
        contractAddress: details.to,
      };
    } catch (error) {
      this.logger.error('Error analyzing token transfer:', error.message);
      return null;
    }
  }
}