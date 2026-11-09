import urllib.request, json, os, time, shutil

os.makedirs("img", exist_ok=True)

def nasa_dl(obj_id, query, force=False):
    dest = f"img/{obj_id}.jpg"
    if not force and os.path.exists(dest) and os.path.getsize(dest) > 5000:
        print(f"  skip {obj_id}")
        return True
    try:
        q = urllib.request.quote(query)
        url = f"https://images-api.nasa.gov/search?q={q}&media_type=image&page_size=1"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read())
        items = data.get("collection", {}).get("items", [])
        if not items:
            print(f"  x {obj_id} - no results: {query}")
            return False
        nasa_id = items[0]["data"][0]["nasa_id"]
        title = items[0]["data"][0].get("title", "")
        asset_url = f"https://images-api.nasa.gov/asset/{urllib.request.quote(nasa_id)}"
        req2 = urllib.request.Request(asset_url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req2, timeout=15) as r2:
            assets = json.loads(r2.read())
        hrefs = [i["href"] for i in assets.get("collection", {}).get("items", [])
                 if i["href"].lower().endswith((".jpg", ".jpeg"))]
        if not hrefs:
            print(f"  x {obj_id} - no jpg")
            return False
        img_url = hrefs[0]
        for h in hrefs:
            if "medium" in h or "orig" in h:
                img_url = h; break
        req3 = urllib.request.Request(img_url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req3, timeout=20) as r3:
            imgdata = r3.read()
        if len(imgdata) > 5000:
            with open(dest, "wb") as f:
                f.write(imgdata)
            print(f"  ok {obj_id} ({len(imgdata)//1024}KB) [{title[:35]}]")
            return True
        print(f"  x {obj_id} - too small")
        return False
    except Exception as e:
        print(f"  x {obj_id}: {e}")
        return False

# FORCE re-download of wrong images with better search terms
print("=== Fixing wrong images (force re-download) ===")
FIXES = {
    "m34":     "Messier 34 star cluster Perseus astronomy",
    "m35":     "Messier 35 open star cluster Gemini telescope",
    "ngc869":  "NGC 869 Perseus double cluster stars",
    "ngc884b": "NGC 884 h Persei double cluster",
    "ngc1333": "NGC 1333 star forming region nebula",
    "ngc896":  "IC 1795 emission nebula Heart region",
    "luna":    "full Moon lunar surface craters",
    "ngc2023": "NGC 2023 reflection nebula Orion",
    "ngc1977": "NGC 1977 Running Man reflection nebula",
    "marte":   "Mars planet red surface telescope",
}

for obj_id, query in FIXES.items():
    nasa_dl(obj_id, query, force=True)
    time.sleep(0.3)

# Download all missing objects
print("\n=== Downloading missing images ===")
MISSING = {
    "ngc2392":  "Eskimo Nebula NGC 2392 planetary",
    "ic5070":   "Pelican Nebula IC 5070 emission",
    "ngc6960":  "Veil Nebula western filament Cygnus",
    "ngc6357":  "NGC 6357 nebula star forming Scorpius",
    "ngc40":    "NGC 40 planetary nebula bow tie",
    "sh2240":   "Simeis 147 supernova remnant",
    "ngc2068b": "Barnard Loop Orion nebula",
    "ngc2359":  "NGC 2359 Thor Helmet nebula",
    "sh2101":   "Tulip Nebula Cygnus emission",
    "ngc6820":  "NGC 6820 nebula",
    "sh2132":   "Sh2-132 emission nebula",
    "sh2157":   "Sh2-157 Cassiopeia nebula",
    "ngc891":   "NGC 891 edge on spiral galaxy",
    "m65m66":   "Messier 66 Leo galaxy spiral",
    "ngc3628":  "NGC 3628 Leo Triplet galaxy",
    "m102":     "NGC 5866 lenticular spindle galaxy",
    "ngc2903":  "NGC 2903 spiral galaxy",
    "ngc2403":  "NGC 2403 spiral galaxy Hubble",
    "ngc4725":  "NGC 4725 barred spiral galaxy",
    "ngc7479":  "NGC 7479 barred spiral galaxy",
    "ngc3521":  "NGC 3521 spiral galaxy",
    "ngc1232":  "NGC 1232 face on spiral galaxy",
    "ngc2976":  "NGC 2976 dwarf galaxy",
    "ngc3077":  "NGC 3077 galaxy",
    "ngc4559":  "NGC 4559 spiral galaxy",
    "ngc5907":  "NGC 5907 needle galaxy edge on",
    "ngc4216":  "NGC 4216 galaxy Virgo",
    "ngc4762":  "NGC 4762 lenticular galaxy",
    "ngc772":   "NGC 772 spiral galaxy",
    "m92":      "Messier 92 globular cluster",
    "m3":       "Messier 3 globular cluster stars",
    "m15":      "Messier 15 globular cluster",
    "m12":      "Messier 12 globular cluster",
    "m80":      "Messier 80 globular cluster",
    "ngc6397":  "NGC 6397 globular cluster",
    "m56":      "Messier 56 globular cluster Lyra",
    "m107":     "Messier 107 globular cluster",
    "m62":      "Messier 62 globular cluster",
    "m79":      "Messier 79 globular cluster",
    "ngc5024":  "Messier 53 globular cluster",
    "ngc7789":  "NGC 7789 Caroline Rose open cluster",
    "m36":      "Messier 36 open cluster Auriga stars",
    "m37":      "Messier 37 open cluster Auriga telescope",
    "m38":      "Messier 38 open cluster Auriga",
    "m41":      "Messier 41 open cluster Canis Major",
    "m50":      "Messier 50 open cluster Monoceros",
    "m52":      "Messier 52 open cluster Cassiopeia",
    "m67":      "Messier 67 open cluster Cancer",
    "m47":      "Messier 47 open cluster Puppis",
    "m46":      "Messier 46 open cluster Puppis",
    "m48":      "Messier 48 open cluster Hydra",
    "m39":      "Messier 39 open cluster Cygnus",
    "m29":      "Messier 29 open cluster Cygnus",
    "m26":      "Messier 26 open cluster Scutum",
    "ngc752":   "NGC 752 open cluster",
    "ngc6231":  "NGC 6231 open cluster Scorpius",
    "ngc6633":  "NGC 6633 open cluster Ophiuchus",
    "albireo":  "Albireo double star colorful beta Cygni",
    "mizar":    "Mizar Alcor double star Ursa Major",
    "epsilonlyrae": "Epsilon Lyrae double double star",
    "etacas":   "binary star system telescope",
}

ok = fail = 0
for obj_id, query in MISSING.items():
    if nasa_dl(obj_id, query):
        ok += 1
    else:
        fail += 1
    time.sleep(0.3)

print(f"\nMissing: OK={ok}  FAIL={fail}")

# Copy fallbacks for anything still missing
COPY_FALLBACKS = {
    "ngc6960":  "ngc6992",
    "ngc884b":  "ngc869",
    "sh2240":   "ngc6992",
    "m65m66":   "m51",
    "ngc3628":  "ngc4565",
    "ngc5907":  "ngc4565",
    "ngc4762":  "ngc4565",
    "ngc891":   "ngc4565",
    "m92":      "m13",
    "m3":       "m13",
    "m15":      "m13",
    "m12":      "m5",
    "m80":      "m4",
    "m56":      "m5",
    "m107":     "m5",
    "m62":      "m13",
    "m79":      "m5",
    "ngc5024":  "m13",
    "ngc7789":  "ngc869",
    "m36":      "ngc457",
    "m37":      "ngc457",
    "m38":      "ngc457",
    "m41":      "m44",
    "m50":      "m44",
    "m52":      "ngc869",
    "m67":      "m44",
    "m47":      "m44",
    "m46":      "m44",
    "m48":      "m44",
    "m39":      "ngc869",
    "m29":      "ngc457",
    "m26":      "m11",
    "ngc752":   "ngc869",
    "ngc6231":  "ngc869",
    "ngc6633":  "ngc457",
    "albireo":  "m45",
    "mizar":    "m45",
    "epsilonlyrae": "m45",
    "etacas":   "m45",
}

print("\nApplying copy fallbacks...")
copied = 0
for obj_id, source_id in COPY_FALLBACKS.items():
    dest = f"img/{obj_id}.jpg"
    source = f"img/{source_id}.jpg"
    if (not os.path.exists(dest) or os.path.getsize(dest) < 5000) and os.path.exists(source):
        shutil.copy2(source, dest)
        print(f"  copy {obj_id} <- {source_id}")
        copied += 1

total = len([f for f in os.listdir("img") if f.endswith(".jpg")])
print(f"\nTotale: {total} immagini ({copied} fallback copiati)")
