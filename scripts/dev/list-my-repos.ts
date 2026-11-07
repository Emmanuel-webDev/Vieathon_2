import dns from "dns";
dns.setDefaultResultOrder?.("ipv4first");

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const res = await fetch("https://api.github.com/user/repos?per_page=100&type=owner", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "NightWatch-Test",
    },
  });
  const data = await res.json();
  if (Array.isArray(data)) {
    console.log("Found", data.length, "repos:");
    for (const r of data) {
      console.log(`- ${r.full_name} (private: ${r.private}, permissions: ${JSON.stringify(r.permissions)})`);
    }
  } else {
    console.log("Error:", data);
  }
}

main().catch(console.error);
