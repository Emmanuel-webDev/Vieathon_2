import dns from "dns";
dns.setDefaultResultOrder?.("ipv4first");

async function main() {
  const token = process.env.GITHUB_TOKEN;
  console.log("Testing token with prefix:", token?.slice(0, 15));
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "NightWatch-Test",
    },
  });
  console.log("Status:", res.status);
  const data = await res.json();
  console.log("User:", data.login, data.message);
}

main().catch(console.error);
