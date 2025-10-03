import { Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { SolanaService } from './solana.service';

@ApiTags('solana-alerts')
@Controller('solana/alerts')
export class SolanaAlertsController {
    constructor(private readonly solanaService: SolanaService) {}

    @Get()
    @ApiOperation({ summary: 'Get active whale alerts' })
    @ApiResponse({ 
        status: 200, 
        description: 'Active alerts retrieved successfully',
        schema: {
            type: 'object',
            properties: {
                alerts: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            timestamp: { type: 'number' },
                            whaleAddress: { type: 'string' },
                            tokenAddress: { type: 'string' },
                            alertLevel: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
                            message: { type: 'string' },
                            read: { type: 'boolean' },
                            tokenAnalysis: {
                                type: 'object',
                                properties: {
                                    name: { type: 'string' },
                                    symbol: { type: 'string' },
                                    price: { type: 'number' },
                                    marketCap: { type: 'number' },
                                    liquidity: { type: 'number' },
                                    investmentScore: { type: 'number' },
                                    riskLevel: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'EXTREME'] },
                                    alerts: { type: 'array', items: { type: 'string' } },
                                    recommendations: { type: 'array', items: { type: 'string' } },
                                }
                            }
                        }
                    }
                },
                count: { type: 'number' }
            }
        }
    })
    async getActiveAlerts(): Promise<{ alerts: any[]; count: number; timestamp: string }> {
        const alerts = this.solanaService.getActiveAlerts();
        return {
            alerts,
            count: alerts.length,
            timestamp: new Date().toISOString(),
        };
    }

    @Patch(':alertId/read')
    @ApiOperation({ summary: 'Mark alert as read' })
    @ApiParam({ name: 'alertId', description: 'Alert ID' })
    @ApiResponse({ 
        status: 200, 
        description: 'Alert marked as read successfully',
        schema: {
            type: 'object',
            properties: {
                success: { type: 'boolean' },
                message: { type: 'string' }
            }
        }
    })
    async markAlertAsRead(@Param('alertId') alertId: string): Promise<{ success: boolean; message: string }> {
        const success = this.solanaService.markAlertAsRead(alertId);
        return {
            success,
            message: success ? 'Alert marked as read' : 'Alert not found',
        };
    }

    @Get('monitored-whales')
    @ApiOperation({ summary: 'Get monitored whale addresses' })
    @ApiResponse({ 
        status: 200, 
        description: 'Monitored whales retrieved successfully',
        schema: {
            type: 'object',
            properties: {
                whales: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            address: { type: 'string' },
                            balance: { type: 'number' },
                            lastSeen: { type: 'number' },
                            tokenCount: { type: 'number' },
                            totalValue: { type: 'number' },
                        }
                    }
                },
                count: { type: 'number' }
            }
        }
    })
    async getMonitoredWhales(): Promise<{ whales: any[]; count: number; timestamp: string }> {
        const whales = this.solanaService.getMonitoredWhales();
        return {
            whales,
            count: whales.length,
            timestamp: new Date().toISOString(),
        };
    }

    @Get('token-analysis/:tokenAddress')
    @ApiOperation({ summary: 'Get token analysis from cache' })
    @ApiParam({ name: 'tokenAddress', description: 'Token contract address' })
    @ApiResponse({ 
        status: 200, 
        description: 'Token analysis retrieved successfully',
        schema: {
            type: 'object',
            properties: {
                analysis: {
                    type: 'object',
                    properties: {
                        address: { type: 'string' },
                        name: { type: 'string' },
                        symbol: { type: 'string' },
                        price: { type: 'number' },
                        marketCap: { type: 'number' },
                        fdv: { type: 'number' },
                        liquidity: { type: 'number' },
                        volume24h: { type: 'number' },
                        priceChange24h: { type: 'number' },
                        age: { type: 'number' },
                        holders: { type: 'number' },
                        socialScore: { type: 'number' },
                        bondingCurveScore: { type: 'number' },
                        investmentScore: { type: 'number' },
                        riskLevel: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'EXTREME'] },
                        alerts: { type: 'array', items: { type: 'string' } },
                        recommendations: { type: 'array', items: { type: 'string' } },
                    }
                },
                cached: { type: 'boolean' }
            }
        }
    })
    async getTokenAnalysis(@Param('tokenAddress') tokenAddress: string): Promise<{ analysis: any; cached: boolean; timestamp: string }> {
        const analysis = this.solanaService.getTokenAnalysis(tokenAddress);
        return {
            analysis,
            cached: analysis !== null,
            timestamp: new Date().toISOString(),
        };
    }

    @Get('stats')
    @ApiOperation({ summary: 'Get Solana whale tracking statistics' })
    @ApiResponse({ 
        status: 200, 
        description: 'Statistics retrieved successfully',
        schema: {
            type: 'object',
            properties: {
                totalAlerts: { type: 'number' },
                activeWhales: { type: 'number' },
                unreadAlerts: { type: 'number' },
                criticalAlerts: { type: 'number' },
                highScoreTokens: { type: 'number' },
                lastUpdate: { type: 'string' },
            }
        }
    })
    async getStats(): Promise<{ totalAlerts: number; activeWhales: number; unreadAlerts: number; criticalAlerts: number; highScoreTokens: number; lastUpdate: string }> {
        const alerts = this.solanaService.getActiveAlerts();
        const whales = this.solanaService.getMonitoredWhales();
        
        const unreadAlerts = alerts.filter(alert => !alert.read).length;
        const criticalAlerts = alerts.filter(alert => alert.alertLevel === 'CRITICAL').length;
        const highScoreTokens = alerts.filter(alert => 
            alert.tokenAnalysis.investmentScore >= 80
        ).length;

        return {
            totalAlerts: alerts.length,
            activeWhales: whales.length,
            unreadAlerts,
            criticalAlerts,
            highScoreTokens,
            lastUpdate: new Date().toISOString(),
        };
    }
}
