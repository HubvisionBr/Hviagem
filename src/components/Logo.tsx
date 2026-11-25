import logo from "@/assets/hviagem-logo.webp";
import logoDark from "@/assets/hviagem-logo-dark.webp";
import icon from "@/assets/hviagem-icon.png";
import iconDark from "@/assets/hviagem-icon-dark.png";

// Troca a versão da marca conforme o tema, só com CSS (classes dark:).
export function Logo({ variant = "full", className = "" }: { variant?: "full" | "icon"; className?: string }) {
  const [light, dark, w, h] = variant === "full" ? [logo, logoDark, 2000, 543] : [icon, iconDark, 548, 780];
  return (
    <>
      <img src={light} alt="HViagem" width={w} height={h} className={`dark:hidden object-contain ${className}`} />
      <img src={dark} alt="HViagem" width={w} height={h} className={`hidden dark:block object-contain ${className}`} />
    </>
  );
}
