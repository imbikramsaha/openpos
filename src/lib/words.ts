// Amount in words for invoices (English). Uses the Indian lakh/crore system for INR.

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function below1000(n: number): string {
  const h = Math.floor(n / 100)
  const r = n % 100
  const parts: string[] = []
  if (h) parts.push(`${ONES[h]} Hundred`)
  if (r) parts.push(r < 20 ? ONES[r] : `${TENS[Math.floor(r / 10)]}${r % 10 ? ' ' + ONES[r % 10] : ''}`)
  return parts.join(' ')
}

export function numberToWords(n: number, indian = false): string {
  n = Math.floor(Math.abs(n))
  if (n === 0) return 'Zero'
  const parts: string[] = []
  if (indian) {
    const crore = Math.floor(n / 1e7)
    const lakh = Math.floor((n % 1e7) / 1e5)
    const thousand = Math.floor((n % 1e5) / 1e3)
    const rest = n % 1e3
    if (crore) parts.push(`${numberToWords(crore, true)} Crore`)
    if (lakh) parts.push(`${below1000(lakh)} Lakh`)
    if (thousand) parts.push(`${below1000(thousand)} Thousand`)
    if (rest) parts.push(below1000(rest))
  } else {
    const scales: Array<[number, string]> = [[1e12, 'Trillion'], [1e9, 'Billion'], [1e6, 'Million'], [1e3, 'Thousand']]
    let rest = n
    for (const [v, name] of scales) {
      if (rest >= v) {
        parts.push(`${below1000(Math.floor(rest / v))} ${name}`)
        rest %= v
      }
    }
    if (rest) parts.push(below1000(rest))
  }
  return parts.join(' ')
}

const UNIT_NAMES: Record<string, [string, string]> = {
  INR: ['Rupees', 'Paise'], USD: ['Dollars', 'Cents'], EUR: ['Euros', 'Cents'], GBP: ['Pounds', 'Pence'],
  AED: ['Dirhams', 'Fils'], SAR: ['Riyals', 'Halalas'], PKR: ['Rupees', 'Paisa'], NPR: ['Rupees', 'Paisa'],
  LKR: ['Rupees', 'Cents'], BDT: ['Taka', 'Poisha'], AUD: ['Dollars', 'Cents'], CAD: ['Dollars', 'Cents'], SGD: ['Dollars', 'Cents'],
}

export function amountInWords(minor: number, currency: string, decimals: number): string {
  const [major, sub] = UNIT_NAMES[currency] ?? [currency, '']
  const whole = Math.floor(Math.abs(minor) / 10 ** decimals)
  const frac = Math.abs(minor) % 10 ** decimals
  const indian = currency === 'INR' || currency === 'NPR' || currency === 'PKR' || currency === 'BDT'
  let s = `${major} ${numberToWords(whole, indian)}`
  if (frac && sub) s += ` and ${numberToWords(frac)} ${sub}`
  return `${s} Only`
}
