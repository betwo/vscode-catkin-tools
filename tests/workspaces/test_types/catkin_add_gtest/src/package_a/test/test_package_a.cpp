#include <gtest/gtest.h>

TEST(TestSuite, succeeds)
{
    SUCCEED();
}

TEST(TestSuite, fails)
{
    FAIL();
}
