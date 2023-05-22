import './globals.css'
import { Inter } from 'next/font/google'

const inter = Inter({ subsets: ['latin'] })

export const metadata = {
  title: 'Mint Porcupine Playground Pals',
  description: 'Porcupine Playground Pals is a Solana NFT collection donating proceeds to causes that promote play for kids or support lung cancer patients and families.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  )
}
