import EthConverter from "@/components/EthConverter";
import WhaleTracker from "@/components/WhaleTracker";

const Index = () => {
  return (
    <div className="min-h-screen bg-gradient-dark">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold mb-4 bg-gradient-primary bg-clip-text text-transparent">
            EthConverter Pro
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Professional Ethereum unit converter with real-time whale transaction tracking
          </p>
        </div>

        {/* Main Content */}
        <div className="grid lg:grid-cols-2 gap-8 max-w-7xl mx-auto">
          {/* Left Column - Converter */}
          <div className="space-y-6">
            <EthConverter />
          </div>

          {/* Right Column - Whale Tracker */}
          <div className="space-y-6">
            <WhaleTracker />
          </div>
        </div>

        {/* Footer */}
        <footer className="mt-16 text-center text-muted-foreground">
          <p className="text-sm">
            Built with React & TypeScript • Data from CoinGecko & Ethereum Network
          </p>
        </footer>
      </div>
    </div>
  );
};

export default Index;
