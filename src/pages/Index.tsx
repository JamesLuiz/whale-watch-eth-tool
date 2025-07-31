import EthConverter from "@/components/EthConverter";
import WhaleTracker from "@/components/WhaleTracker";

const Index = () => {
  return (
    <div className="min-h-screen bg-gradient-dark">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8">
        {/* Header */}
        <div className="text-center mb-8 sm:mb-10 lg:mb-12">
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-3 sm:mb-4 bg-gradient-primary bg-clip-text text-transparent">
            EthConverter Pro
          </h1>
          <p className="text-base sm:text-lg lg:text-xl text-muted-foreground max-w-2xl mx-auto px-4">
            Professional Ethereum unit converter with real-time whale transaction tracking
          </p>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8 max-w-7xl mx-auto">
          {/* Left Column - Converter */}
          <div className="space-y-6 order-1 lg:order-1">
            <EthConverter />
          </div>

          {/* Right Column - Whale Tracker */}
          <div className="space-y-6 order-2 lg:order-2">
            <WhaleTracker />
          </div>
        </div>

        {/* Footer */}
        <footer className="mt-12 sm:mt-14 lg:mt-16 text-center text-muted-foreground">
          <p className="text-xs sm:text-sm px-4">
            Built with React & TypeScript • Data from CoinGecko & Ethereum Network
          </p>
        </footer>
      </div>
    </div>
  );
};

export default Index;
