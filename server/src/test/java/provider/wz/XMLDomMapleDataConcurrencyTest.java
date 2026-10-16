package provider.wz;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import provider.Data;

import java.io.FileInputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class XMLDomMapleDataConcurrencyTest {
    @TempDir
    Path directory;

    @Test
    void independentChildAndParentWrappersReadOneDocumentConcurrently() throws Exception {
        StringBuilder xml = new StringBuilder("<imgdir name=\"Etc.img\">\n");
        for (int index = 0; index < 128; index++) {
            xml.append("<imgdir name=\"").append(4000000 + index)
                    .append("\"><string name=\"name\" value=\"Item ").append(index)
                    .append("\"/><int name=\"price\" value=\"").append(index)
                    .append("\"/><vector name=\"origin\" x=\"0\" y=\"0\"/></imgdir>\n");
        }
        xml.append("</imgdir>");
        Path source = directory.resolve("Etc.img.xml");
        Files.writeString(source, xml);
        Data root;
        try (FileInputStream input = new FileInputStream(source.toFile())) {
            root = new XMLDomMapleData(input, directory);
        }
        List<Data> aliases = new ArrayList<>();
        for (int index = 0; index < 16; index++) {
            aliases.add((Data) root.getChildByPath("4000000").getParent());
        }
        CountDownLatch start = new CountDownLatch(1);
        try (var readers = Executors.newFixedThreadPool(aliases.size())) {
            var results = new ArrayList<java.util.concurrent.Future<?>>();
            for (int worker = 0; worker < aliases.size(); worker++) {
                int identity = worker;
                Data alias = aliases.get(worker);
                results.add(readers.submit(() -> {
                    start.await();
                    for (int pass = 0; pass < 750; pass++) {
                        int index = (pass * 31 + identity) % 128;
                        Data item = (pass & 1) == 0
                                ? alias.getChildByPath(Integer.toString(4000000 + index))
                                : alias.getChildren().get(index);
                        assertEquals("Item " + index, item.getChildByPath("name").getData());
                        assertEquals(index, item.getChildByPath("price").getData());
                        assertEquals(DataType.PROPERTY, item.getType());
                        assertEquals("Etc.img", item.getParent().getName());
                        assertNull(item.getChildByPath("missing"));
                        var children = item.iterator();
                        assertEquals("name", children.next().getName());
                        assertEquals("price", children.next().getName());
                        assertEquals("origin", children.next().getName());
                    }
                    return null;
                }));
            }
            start.countDown();
            for (var result : results) result.get(30, TimeUnit.SECONDS);
        }
    }
}
