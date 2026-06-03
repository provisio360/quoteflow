-- CreateEnum
CREATE TYPE "ConversionStatus" AS ENUM ('pending', 'auto', 'manual');

-- AlterTable
ALTER TABLE "quote" ADD COLUMN     "conversionStatus" "ConversionStatus",
ADD COLUMN     "convertedUsdPrice" DECIMAL(14,4),
ADD COLUMN     "convertedUsdPricePerUnit" DECIMAL(14,4),
ADD COLUMN     "exchangeRate" DECIMAL(18,8),
ADD COLUMN     "rateDate" TIMESTAMP(3);
