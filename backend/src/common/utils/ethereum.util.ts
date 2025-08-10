import { ethers } from 'ethers';

export class EthereumUtil {
  static formatEther(wei: string): string {
    try {
      return ethers.formatEther(wei);
    } catch (error) {
      return '0';
    }
  }

  static parseEther(ether: string): string {
    try {
      return ethers.parseEther(ether).toString();
    } catch (error) {
      return '0';
    }
  }

  static formatUnits(value: string, decimals: number): string {
    try {
      return ethers.formatUnits(value, decimals);
    } catch (error) {
      return '0';
    }
  }

  static parseUnits(value: string, decimals: number): string {
    try {
      return ethers.parseUnits(value, decimals).toString();
    } catch (error) {
      return '0';
    }
  }

  static isValidAddress(address: string): boolean {
    try {
      return ethers.isAddress(address);
    } catch (error) {
      return false;
    }
  }

  static checksumAddress(address: string): string {
    try {
      return ethers.getAddress(address);
    } catch (error) {
      return address;
    }
  }

  static formatGwei(wei: string): string {
    try {
      return ethers.formatUnits(wei, 'gwei');
    } catch (error) {
      return '0';
    }
  }

  static isWhaleTransaction(valueEth: string, minThreshold: number = 100): boolean {
    try {
      const value = parseFloat(valueEth);
      return value >= minThreshold;
    } catch (error) {
      return false;
    }
  }

  static calculateUsdValue(ethAmount: string, ethPrice: number): number {
    try {
      const eth = parseFloat(ethAmount);
      return eth * ethPrice;
    } catch (error) {
      return 0;
    }
  }
}