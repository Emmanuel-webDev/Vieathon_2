import dns from "dns";
dns.setDefaultResultOrder?.("ipv4first");

async function main() {
  const r = await fetch("https://api.github.com/user/repos?per_page=10&sort=updated", {
    headers: { authorization: "Bearer " + process.env.GITHUB_TOKEN, "user-agent": "nightwatch" }
  });
  const repos = await r.json();
  console.log("Repos:", repos.map((x: any) => ({ name: x.name, full_name: x.full_name, html_url: x.html_url })));
}
main().catch(console.error);
