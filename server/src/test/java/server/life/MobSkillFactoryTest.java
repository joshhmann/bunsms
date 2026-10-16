package server.life;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.MockitoAnnotations;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertAll;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class MobSkillFactoryTest {

    @TempDir
    private Path wzPath;

    @BeforeEach
    void setWzPath() {
        MockitoAnnotations.openMocks(this);
        writeTestFileToTempDir();
        System.setProperty("wz-path", "%s/wz".formatted(wzPath.toString()));
    }

    private void writeTestFileToTempDir() {
        try {
            String testFileContents = readTestFileContents();
            writeTempDirFile(testFileContents);
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
    }

    private String readTestFileContents() throws IOException {
        return new String(getClass()
                .getClassLoader()
                .getResourceAsStream("MobSkill-test.img.xml")
                .readAllBytes()
        );
    }

    private void writeTempDirFile(String fileContents) throws IOException {
        Path tempDirDirectory = wzPath.resolve("wz/Skill.wz");
        Files.createDirectories(tempDirDirectory);
        Path tempDirFile = Files.createFile(tempDirDirectory.resolve("MobSkill.img.xml"));
        Files.writeString(tempDirFile, fileContents);
    }

    @Test
    void shouldLoadExistingMobSkill() {
        Optional<MobSkill> possibleSkill = MobSkillFactory.getMobSkill(MobSkillType.ATTACK_UP, 1);

        assertTrue(possibleSkill.isPresent());
        MobSkill mobSkill = possibleSkill.get();
        assertAll("MobSkill",
                () -> assertEquals(115, mobSkill.getX()),
                () -> assertEquals(5, mobSkill.getMpCon()),
                () -> assertEquals(40_000, mobSkill.getCoolTime()),
                () -> assertEquals(30_000, mobSkill.getDuration())
        );
    }

    @Test
    void builderCarriesSpawnEffect() {
        // The factory dropped .spawnEffect(effect) once: staged summon visuals
        // (e.g. 200/222 effect 36) silently never rendered. Pin the wiring.
        MobSkill skill = new MobSkill.Builder(MobSkillType.SUMMON, 222)
                .mpCon(0).toSummon(java.util.List.of(8880164)).spawnEffect(36)
                .cooltime(0).duration(0).hp(100).x(1).y(1).count(1).prop(1.0f)
                .limit(4).lt(null).rb(null).build();
        assertEquals(36, skill.getSpawnEffect());
    }

    @Test
    void shouldThrowExceptionOnNonExisting() {
        assertThrows(IllegalArgumentException.class, () -> MobSkillFactory.getMobSkillOrThrow(MobSkillType.DEFENSE_UP, 1));
    }

}
