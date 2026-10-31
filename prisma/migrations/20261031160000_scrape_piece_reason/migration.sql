-- Why a withheld piece is withheld (withheld | not_published). Additive.
ALTER TABLE "ScrapePiece" ADD COLUMN "reason" TEXT;
