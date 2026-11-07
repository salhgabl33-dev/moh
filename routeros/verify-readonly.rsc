# Read-only checks on CCR2116 after testing one HotSpot account.
# Contains client identifiers; inspect locally and do not publish the output.
/ip hotspot active print detail;
/queue simple print detail where name~"^HN27-";
/ip firewall address-list print detail where list="*yes**" and comment~"^HN27:";
/log print where message~"HN27";
