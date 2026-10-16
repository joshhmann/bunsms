package soloMapling.itemPool;

import com.esotericsoftware.yamlbeans.YamlReader;

import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.*;

public class DesirableEquipList {

    private static final String YAML_PATH = "/soloMapling/itemPool/itemConfig/desirableEquips.yaml";
    private static final Set<Integer> desirableIds = new HashSet<>();
    private static boolean loaded = false;

    public static synchronized void load() {
        if (loaded) return;
        long start = System.currentTimeMillis();
        try (InputStream stream = DesirableEquipList.class.getResourceAsStream(YAML_PATH);
             InputStreamReader input = new InputStreamReader(
                     Objects.requireNonNull(stream, "Required bot gear resource " + YAML_PATH), StandardCharsets.UTF_8)) {
            YamlReader reader = new YamlReader(input);
            @SuppressWarnings("unchecked")
            Map<String, List<String>> categories = (Map<String, List<String>>) reader.read();
            if (categories == null) {
                loaded = true;
                return;
            }
            for (Map.Entry<String, List<String>> entry : categories.entrySet()) {
                List<String> ids = entry.getValue();
                if (ids == null) continue;
                for (String raw : ids) {
                    try {
                        desirableIds.add(Integer.parseInt(raw.toString().trim()));
                    } catch (NumberFormatException ignored) {
                    }
                }
            }
            loaded = true;
            System.out.println("[DesirableEquipList] Loaded " + desirableIds.size() + " whitelisted item IDs in "
                    + (System.currentTimeMillis() - start) + "ms");
        } catch (Exception e) {
            System.err.println("[DesirableEquipList] Failed to load: " + e.getMessage());
            loaded = true;
        }
    }

    public static boolean isDesirable(int itemId) {
        return desirableIds.contains(itemId);
    }

    public static Set<Integer> getAll() {
        return Collections.unmodifiableSet(desirableIds);
    }
}
