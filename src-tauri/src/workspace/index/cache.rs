//! ISC-283: the cache file of a root: what is in it, when it is not trusted, and when it goes.

use super::testkit::*;
use super::*;
use crate::fs::exclude;

fn cached_index(cache: &Path) -> WorkspaceIndex {
    let index = index();
    index.set_cache_dir(cache.to_path_buf());
    index
}

fn files_in(cache: &Path) -> Vec<String> {
    std::fs::read_dir(cache)
        .map(|listing| {
            listing
                .flatten()
                .map(|entry| entry.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default()
}

#[test]
fn a_cache_written_for_a_root_reads_back_equal() {
    let dir = tree(&["a.md", "b/c.txt", "b/d/e.png"]);
    let root = root(&dir);
    let cache = tempfile::tempdir().expect("a temp dir");
    let index = cached_index(cache.path());
    index.add_root_now(&root);
    index.flush_cache();

    let loaded = cachefile::load(cache.path(), &display_path(&root)).expect("a good cache file");
    assert_eq!(loaded.entries, index.entries(&root));
    assert_eq!(loaded.entries.len(), 3);
    assert!(loaded.folders >= 3, "the root and its two folders");
    assert!(!loaded.cut);
}

#[test]
fn the_cache_holds_paths_and_facts_and_never_contents() {
    let dir = tree(&[]);
    let root = root(&dir);
    put(&root, "secret.md", "UNIQUE-CONTENT-MARKER-12345");
    let cache = tempfile::tempdir().expect("a temp dir");
    let index = cached_index(cache.path());
    index.add_root_now(&root);
    index.flush_cache();

    let bytes = std::fs::read(cachefile::file_for(cache.path(), &display_path(&root)))
        .expect("the cache file is there");
    let marker = b"UNIQUE-CONTENT-MARKER-12345";
    assert!(
        !bytes.windows(marker.len()).any(|window| window == marker),
        "no file content is in the cache"
    );
    assert!(
        bytes.windows(9).any(|window| window == b"secret.md"),
        "the path is"
    );
}

#[test]
fn each_root_has_a_file_of_its_own() {
    let one = tree(&["a.md"]);
    let two = tree(&["b.md"]);
    let cache = tempfile::tempdir().expect("a temp dir");
    let index = cached_index(cache.path());
    index.add_root_now(&root(&one));
    index.add_root_now(&root(&two));
    index.flush_cache();
    assert_eq!(files_in(cache.path()).len(), 2);
}

fn sample(root: &str) -> (Vec<FileEntry>, Vec<u8>) {
    let entries = vec![
        FileEntry {
            rel: "a.md".into(),
            kind: FileKind::Markdown,
            size: 3,
            modified: 1_700_000_000_000,
        },
        FileEntry {
            rel: "b/c.txt".into(),
            kind: FileKind::Text,
            size: 0,
            modified: 0,
        },
    ];
    let bytes = cachefile::encode(root, 4, false, &entries);
    (entries, bytes)
}

#[test]
fn a_file_made_by_this_version_for_this_root_is_trusted() {
    let (entries, bytes) = sample("/w");
    let loaded = cachefile::decode(&bytes, "/w").expect("good");
    assert_eq!(loaded.entries, entries);
    assert_eq!(loaded.folders, 4);
}

#[test]
fn another_version_another_exclusion_list_or_another_root_is_not_trusted() {
    let (entries, _) = sample("/w");
    let other_version = cachefile::encode_with(
        cachefile::VERSION + 1,
        exclude::signature(),
        "/w",
        4,
        false,
        &entries,
    );
    assert!(cachefile::decode(&other_version, "/w").is_none());

    let other_list = cachefile::encode_with(
        cachefile::VERSION,
        exclude::signature() ^ 1,
        "/w",
        4,
        false,
        &entries,
    );
    assert!(cachefile::decode(&other_list, "/w").is_none());

    let (_, bytes) = sample("/w");
    assert!(cachefile::decode(&bytes, "/elsewhere").is_none());
}

#[test]
fn a_damaged_file_is_not_trusted_whatever_the_damage() {
    let (_, bytes) = sample("/w");
    assert!(cachefile::decode(&bytes, "/w").is_some());
    // Every single flipped byte, and every cut, is caught by the checksum or the layout.
    for at in 0..bytes.len() {
        let mut damaged = bytes.clone();
        damaged[at] ^= 0x40;
        assert!(cachefile::decode(&damaged, "/w").is_none(), "byte {at}");
    }
    for keep in 0..bytes.len() {
        assert!(
            cachefile::decode(&bytes[..keep], "/w").is_none(),
            "cut {keep}"
        );
    }
    let mut longer = bytes.clone();
    longer.push(0);
    assert!(cachefile::decode(&longer, "/w").is_none());
    assert!(cachefile::decode(b"", "/w").is_none());
    assert!(cachefile::decode(b"not an index at all", "/w").is_none());
}

#[test]
fn a_stale_or_broken_cache_is_ignored_and_the_root_is_built_from_the_disk() {
    let dir = tree(&["real.md"]);
    let root = root(&dir);
    let shown = display_path(&root);
    let cache = tempfile::tempdir().expect("a temp dir");
    let ghost = [FileEntry {
        rel: "ghost.md".into(),
        kind: FileKind::Markdown,
        size: 1,
        modified: 1,
    }];

    let stale = [
        cachefile::encode_with(
            cachefile::VERSION + 1,
            exclude::signature(),
            &shown,
            1,
            false,
            &ghost,
        ),
        cachefile::encode_with(
            cachefile::VERSION,
            exclude::signature() ^ 1,
            &shown,
            1,
            false,
            &ghost,
        ),
        b"garbage that is not a cache".to_vec(),
        Vec::new(),
    ];
    for bytes in stale {
        cachefile::save(cache.path(), &shown, &bytes).expect("the stale file is written");
        let index = cached_index(cache.path());
        index.register_only(&root);
        assert!(!index.load_cached_now(&root), "nothing to answer from");
        index.reconcile_now(&root);
        assert_eq!(index.rels(&root), ["real.md"]);
        // And the next write replaces the bad file with a good one.
        index.flush_cache();
        assert!(cachefile::load(cache.path(), &shown).is_some());
    }
}

#[test]
fn a_missing_cache_folder_is_made_when_the_first_file_is_written() {
    let dir = tree(&["a.md"]);
    let root = root(&dir);
    let base = tempfile::tempdir().expect("a temp dir");
    let cache = base.path().join("not").join("yet");
    let index = cached_index(&cache);
    index.add_root_now(&root);
    index.flush_cache();
    assert_eq!(files_in(&cache).len(), 1);
}

#[test]
fn removing_a_root_deletes_its_cache_file_and_leaves_the_others() {
    let one = tree(&["a.md"]);
    let two = tree(&["b.md"]);
    let (one, two) = (root(&one), root(&two));
    let cache = tempfile::tempdir().expect("a temp dir");
    let index = cached_index(cache.path());
    index.add_root_now(&one);
    index.add_root_now(&two);
    index.flush_cache();
    assert_eq!(files_in(cache.path()).len(), 2);

    index.remove_root(&one);
    assert!(cachefile::load(cache.path(), &display_path(&one)).is_none());
    assert!(cachefile::load(cache.path(), &display_path(&two)).is_some());
    assert_eq!(files_in(cache.path()).len(), 1);

    // A write that was due for the removed root does not bring its file back.
    index.flush_cache();
    assert!(cachefile::load(cache.path(), &display_path(&one)).is_none());
}

#[test]
fn a_cache_that_cannot_be_written_does_not_stop_the_index() {
    let dir = tree(&["a.md"]);
    let root = root(&dir);
    let base = tempfile::tempdir().expect("a temp dir");
    // The cache "folder" is a file, so nothing can be made inside it.
    let blocked = base.path().join("blocked");
    std::fs::write(&blocked, b"x").expect("written");
    let index = cached_index(&blocked);
    index.add_root_now(&root);
    index.flush_cache();
    assert_eq!(index.rels(&root), ["a.md"]);
}
